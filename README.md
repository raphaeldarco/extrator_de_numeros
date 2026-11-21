# Extrator de Números – Chrome 1.9.3

Base: Extrator de Números v1.8.6 Chrome AutoChooser.

## Nova função opcional: Google Drive

A versão 1.9.3 adiciona o botão **Enviar para Google Drive**. A gravação continua sendo feita localmente no navegador; o upload só acontece quando o usuário clicar no botão.

O fluxo é:

1. Gravar o vídeo normalmente.
2. Clicar em **Enviar para Google Drive**.
3. Na primeira utilização, o Chrome solicita a autenticação/autorização da conta Google.
4. O vídeo é enviado para o Google Drive da própria conta.
5. A extensão cria uma permissão de leitura do tipo "qualquer pessoa com o link".
6. A extensão mostra **Copiar link** e **Abrir**.

### Escopo utilizado

A extensão usa somente:

`https://www.googleapis.com/auth/drive.file`

Esse escopo é propositalmente mais restrito que `drive`: a extensão trabalha com arquivos criados por ela, em vez de solicitar acesso geral aos arquivos existentes do Drive.

## Configuração obrigatória do desenvolvedor

Antes de distribuir a extensão com a função Google Drive, configure um projeto no Google Cloud e crie um OAuth Client ID para **Chrome Extension**, associado ao ID da extensão publicada na Chrome Web Store.

O `manifest.json` desta versão já está configurado com o OAuth Client ID associado à extensão publicada. Se o ID da extensão publicada mudar no futuro, será necessário criar/associar um novo OAuth Client ID correspondente.

Também é necessário habilitar a **Google Drive API** no projeto.

Sem esse Client ID configurado, a gravação local continua funcionando, mas o botão de envio não conseguirá autenticar.

## Privacidade

O vídeo não é enviado automaticamente. O upload só ocorre após o usuário clicar em **Enviar para Google Drive** e autorizar a conta Google. A extensão não solicita nem armazena a senha da conta.


### Correção 1.9.3
- Upload do Google Drive migrado para o protocolo resumable.
- Removido o multipart com boundary não-ASCII que podia causar HTTP 400.
- Renovação automática do token em caso de HTTP 401.
- Falha no compartilhamento público agora é informada separadamente do upload.

## Ajuste de layout da v1.9.3
Após o envio para o Google Drive, a janela é ampliada automaticamente para exibir integralmente o status e os botões de compartilhamento (Copiar link / Abrir), sem cortar a área inferior.
## Google Drive

As gravações enviadas pelo botão **Enviar para Google Drive** são armazenadas automaticamente na pasta **Ext-gravações de tela**, criada pela extensão na raiz do Google Drive caso ainda não exista. Os uploads seguintes reutilizam essa pasta.
