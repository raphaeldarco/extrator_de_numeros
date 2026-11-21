// Integração opcional com Google Drive.
// Requer um OAuth Client ID configurado no manifest.json.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

async function getDriveToken(interactive = true) {
  if (!chrome?.identity?.getAuthToken) {
    throw new Error("A autenticação do Google não está disponível nesta instalação.");
  }

  try {
    // O Chrome usa o client_id e os escopos declarados no manifest.json.
    // Não repetimos o escopo aqui para evitar divergências entre manifesto e chamada.
    const result = await chrome.identity.getAuthToken({ interactive });
    if (!result?.token) {
      throw new Error("O Google não retornou um token de acesso.");
    }
    return result.token;
  } catch (err) {
    const raw = err?.message || String(err || "Erro desconhecido");
    const extensionId = chrome?.runtime?.id || "desconhecido";
    const manifest = chrome?.runtime?.getManifest?.() || {};
    const clientId = manifest?.oauth2?.client_id || "não configurado";
    throw new Error(
      `Falha na autenticação Google.\n` +
      `Detalhes: ${raw}\n` +
      `ID da extensão: ${extensionId}\n` +
      `OAuth Client ID: ${clientId}`
    );
  }
}

async function invalidateDriveToken(token) {
  if (!token || !chrome?.identity?.removeCachedAuthToken) return;
  try {
    await chrome.identity.removeCachedAuthToken({ token });
  } catch (_) {}
}

async function driveRequest(url, options = {}, token) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      detail = data?.error?.message || "";
    } catch (_) {}

    const error = new Error(detail || `Google Drive respondeu com HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  return response;
}

async function uploadResumable(blob, filename, token, onProgress) {
  const metadata = {
    name: filename,
    mimeType: blob.type || "video/webm"
  };

  // Upload retomável: evita montar um multipart/related gigante em memória e
  // elimina problemas com boundary multipart. É o método mais robusto para
  // vídeos, especialmente quando o arquivo fica maior.
  const initResponse = await driveRequest(
    `${DRIVE_UPLOAD_API}?uploadType=resumable&fields=id,name,mimeType,webViewLink`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": metadata.mimeType,
        "X-Upload-Content-Length": String(blob.size)
      },
      body: JSON.stringify(metadata)
    },
    token
  );

  const sessionUrl = initResponse.headers.get("Location");
  if (!sessionUrl) {
    throw new Error("O Google Drive não retornou a sessão de upload.");
  }

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);
    xhr.setRequestHeader("Content-Type", metadata.mimeType);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable && typeof onProgress === "function") {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (_) {
          reject(new Error("O Google retornou uma resposta inválida após o upload."));
        }
        return;
      }

      let message = `Google Drive respondeu com HTTP ${xhr.status}.`;
      try {
        const data = JSON.parse(xhr.responseText);
        message = data?.error?.message || message;
      } catch (_) {}

      const error = new Error(message);
      error.status = xhr.status;
      reject(error);
    };

    xhr.onerror = () => reject(new Error("Falha de comunicação com o Google Drive durante o upload."));
    xhr.onabort = () => reject(new Error("O upload para o Google Drive foi interrompido."));
    xhr.send(blob);
  });
}

async function uploadBlobToDrive(blob, filename, onProgress) {
  if (!blob || !blob.size) throw new Error("O vídeo não possui dados para envio.");

  let token = await getDriveToken(true);
  let file;

  // Se o token em cache estiver expirado, invalida-o e tenta uma única vez
  // com um novo token. Isso evita falhas desnecessárias com HTTP 401.
  try {
    file = await uploadResumable(blob, filename, token, onProgress);
  } catch (err) {
    if (err?.status !== 401) throw err;
    await invalidateDriveToken(token);
    token = await getDriveToken(true);
    file = await uploadResumable(blob, filename, token, onProgress);
  }

  if (!file?.id) {
    throw new Error("O Google Drive não retornou o identificador do arquivo enviado.");
  }

  const fallbackUrl = `https://drive.google.com/file/d/${file.id}/view`;
  let shareWarning = "";

  // Torna o arquivo acessível por qualquer pessoa que possua o link.
  // Se a conta Google ou o administrador do Workspace bloquear o
  // compartilhamento público, o upload continua válido e o usuário recebe
  // uma mensagem específica em vez de perder a informação de que o arquivo
  // já foi enviado.
  try {
    await driveRequest(
      `${DRIVE_API}/files/${encodeURIComponent(file.id)}/permissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" })
      },
      token
    );
  } catch (err) {
    if (err?.status === 401) {
      await invalidateDriveToken(token);
      token = await getDriveToken(true);
      try {
        await driveRequest(
          `${DRIVE_API}/files/${encodeURIComponent(file.id)}/permissions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "reader", type: "anyone" })
          },
          token
        );
      } catch (retryErr) {
        shareWarning = retryErr?.message || "Não foi possível habilitar o compartilhamento público.";
      }
    } else {
      shareWarning = err?.message || "Não foi possível habilitar o compartilhamento público.";
    }
  }

  // Busca o webViewLink diretamente no Drive após o upload.
  let linkData = file;
  try {
    const linkResponse = await driveRequest(
      `${DRIVE_API}/files/${encodeURIComponent(file.id)}?fields=id,name,webViewLink`,
      {},
      token
    );
    linkData = await linkResponse.json();
  } catch (_) {
    // O fallback baseado no ID continua válido para abrir o arquivo pelo Drive.
  }

  return {
    id: linkData.id || file.id,
    name: linkData.name || filename,
    url: linkData.webViewLink || fallbackUrl,
    shareWarning
  };
}
