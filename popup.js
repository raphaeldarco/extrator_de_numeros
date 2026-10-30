document.addEventListener("DOMContentLoaded", () => {
  const versaoSpan = document.getElementById("versao-app");
  if (chrome?.runtime?.getManifest) versaoSpan.textContent = `v${chrome.runtime.getManifest().version}`;

  const entrada = document.getElementById("entrada");
  const saida = document.getElementById("saida");
  const status = document.getElementById("status");
  const chkValidar = document.getElementById("validar-dv");
  const chkRemoverDuplicados = document.getElementById("remover-duplicados");
  const chkMascara = document.getElementById("com-mascara");

  // Os limites alfanuméricos impedem extrair documentos como partes de identificadores maiores.
  const padroes = {
    CNJ: /(?<![A-Z0-9])\d{7}[-.\s]?\d{2}[-.\s]?\d{4}[-.\s]?\d[-.\s]?\d{2}[-.\s]?\d{4}(?![A-Z0-9])/gi,
    CPF: /(?<![A-Z0-9])\d{3}[.\-\s]?\d{3}[.\-\s]?\d{3}[.\-\s]?\d{2}(?![A-Z0-9])/gi,
    CNPJ: /(?<![A-Z0-9])(?:[A-Z0-9][.\-/]*){13}[A-Z0-9](?![A-Z0-9])/gi,
    "9_10_digitos": /(?<![A-Z0-9])\d{9,10}(?![A-Z0-9])/g
  };
  const ordemTipo = { CNJ: 0, CNPJ: 1, CPF: 2, "9_10_digitos": 3 };

  function normalizar(valor, tipo) {
    if (tipo === "CNPJ") return valor.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    return valor.replace(/\D/g, "");
  }

  function formatarNumero(valor, tipo, comMascara) {
    const limpo = normalizar(valor, tipo);
    if (!comMascara) return limpo;
    if (tipo === "CNJ" && limpo.length === 20) {
      return limpo.replace(/(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})/, "$1-$2.$3.$4.$5.$6");
    }
    if (tipo === "CPF" && limpo.length === 11) {
      return limpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    }
    if (tipo === "CNPJ" && limpo.length === 14) {
      return limpo.replace(/([A-Z0-9]{2})([A-Z0-9]{3})([A-Z0-9]{3})([A-Z0-9]{4})(\d{2})/, "$1.$2.$3/$4-$5");
    }
    return limpo;
  }

  function validarCPF(valor) {
    const cpf = normalizar(valor, "CPF");
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
    let resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== Number(cpf[9])) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    return resto === Number(cpf[10]);
  }

  // CNPJ numérico e alfanumérico: valor ASCII do caractere menos 48 e pesos módulo 11.
  function validarCNPJ(valor) {
    const cnpj = normalizar(valor, "CNPJ");
    if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
    const valorChar = (char) => char.charCodeAt(0) - 48;
    const calcularDV = (base, pesos) => {
      const soma = [...base].reduce((acc, char, i) => acc + valorChar(char) * pesos[i], 0);
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const dv1 = calcularDV(cnpj.slice(0, 12), pesos1);
    if (dv1 !== Number(cnpj[12])) return false;
    const dv2 = calcularDV(cnpj.slice(0, 13), pesos2);
    return dv2 === Number(cnpj[13]);
  }

  // Estrutura CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO; DV calculado por módulo 97.
  function validarCNJ(valor) {
    const num = normalizar(valor, "CNJ");
    if (!/^\d{20}$/.test(num)) return false;
    const sequencial = num.slice(0, 7);
    const dv = num.slice(7, 9);
    const ano = num.slice(9, 13);
    const ramo = num.slice(13, 14);
    const tribunal = num.slice(14, 16);
    const origem = num.slice(16, 20);
    const base = `${sequencial}${ano}${ramo}${tribunal}${origem}00`;
    const calculado = (98n - (BigInt(base) % 97n)).toString().padStart(2, "0");
    return dv === calculado;
  }

  const validadores = { CNJ: validarCNJ, CPF: validarCPF, CNPJ: validarCNPJ };

  function encontrarCandidatos(texto, tipoSelecionado) {
    const tipos = tipoSelecionado === "AUTO"
      ? ["CNJ", "CNPJ", "CPF", "9_10_digitos"]
      : [tipoSelecionado];
    const candidatos = [];
    for (const tipo of tipos) {
      const regex = new RegExp(padroes[tipo].source, padroes[tipo].flags);
      for (const match of texto.matchAll(regex)) {
        candidatos.push({
          tipo,
          bruto: match[0],
          inicio: match.index,
          fim: match.index + match[0].length,
          prioridade: ordemTipo[tipo]
        });
      }
    }

    // Resolve sobreposições: ocorrência mais à esquerda; em empate, tipo mais específico primeiro.
    candidatos.sort((a, b) => a.inicio - b.inicio || (b.fim - b.inicio) - (a.fim - a.inicio) || a.prioridade - b.prioridade);
    const semSobreposicao = [];
    for (const candidato of candidatos) {
      const conflito = semSobreposicao.some(item => candidato.inicio < item.fim && candidato.fim > item.inicio);
      if (!conflito) semSobreposicao.push(candidato);
    }
    return semSobreposicao.sort((a, b) => a.inicio - b.inicio);
  }

  let estadoAtual = { resultados: [], totalEncontrados: 0, rejeitados: 0, duplicados: 0 };

  function atualizarContador(id, rotulo, valor, alerta = false) {
    const el = document.getElementById(id);
    el.textContent = `${rotulo}: ${valor}`;
    el.classList.toggle("alerta", alerta && valor > 0);
  }

  function atualizarTexto() {
    const tipoSelecionado = document.querySelector("input[name='tipo']:checked").value;
    const validar = chkValidar.checked;
    const removerDuplicados = chkRemoverDuplicados.checked;
    const comMascara = chkMascara.checked;
    const texto = entrada.value;

    if (!texto.trim()) {
      estadoAtual = { resultados: [], totalEncontrados: 0, rejeitados: 0, duplicados: 0 };
      saida.textContent = "O resultado aparecerá aqui...";
      atualizarContador("cnt-encontrados", "Encontrados", 0);
      atualizarContador("cnt-resultados", "Resultados", 0);
      atualizarContador("cnt-duplicados", "Duplicados", 0);
      atualizarContador("cnt-invalidos", "Rejeitados", 0);
      status.textContent = "";
      return;
    }

    const candidatos = encontrarCandidatos(texto, tipoSelecionado);
    const aceitos = [];
    let rejeitados = 0;
    for (const candidato of candidatos) {
      const validador = validadores[candidato.tipo];
      if (validar && validador && !validador(candidato.bruto)) rejeitados++;
      else aceitos.push(candidato);
    }

    const resultados = [];
    const vistos = new Set();
    let duplicados = 0;
    for (const item of aceitos) {
      const chave = `${item.tipo}:${normalizar(item.bruto, item.tipo)}`;
      const jaVisto = vistos.has(chave);
      if (jaVisto) {
        duplicados++;
        if (removerDuplicados) continue;
      } else {
        vistos.add(chave);
      }
      resultados.push({
        tipo: item.tipo,
        valor: formatarNumero(item.bruto, item.tipo, comMascara),
        normalizado: normalizar(item.bruto, item.tipo),
        bruto: item.bruto
      });
    }

    estadoAtual = { resultados, totalEncontrados: candidatos.length, rejeitados, duplicados };
    saida.textContent = resultados.length
      ? resultados.map(item => item.valor).join("\n")
      : "Nenhum número encontrado com os critérios atuais.";

    atualizarContador("cnt-encontrados", "Encontrados", candidatos.length);
    atualizarContador("cnt-resultados", "Resultados", resultados.length);
    atualizarContador("cnt-duplicados", "Duplicados", duplicados);
    atualizarContador("cnt-invalidos", "Rejeitados", rejeitados, true);

    const porTipo = {};
    for (const item of resultados) porTipo[item.tipo] = (porTipo[item.tipo] || 0) + 1;
    status.textContent = resultados.length
      ? Object.entries(porTipo).map(([tipo, qtd]) => `${rotuloTipo(tipo)}: ${qtd}`).join(" · ")
      : (rejeitados ? "Todos os candidatos encontrados foram rejeitados pela validação." : "Nenhum candidato identificado.");
  }

  function rotuloTipo(tipo) {
    return ({ CNJ: "Processos CNJ", CPF: "CPF", CNPJ: "CNPJ", "9_10_digitos": "Dígitos 9–10" })[tipo] || tipo;
  }

  function obterValores({ mascara = true } = {}) {
    return estadoAtual.resultados.map(item => mascara ? item.valor : item.normalizado);
  }

  async function copiarDados(botaoId, textoParaCopiar) {
    if (!textoParaCopiar || !estadoAtual.resultados.length) {
      status.textContent = "Não há resultados para copiar.";
      return;
    }
    const btn = document.getElementById(botaoId);
    try {
      await navigator.clipboard.writeText(textoParaCopiar);
      const original = btn.textContent;
      btn.textContent = "Copiado!";
      btn.classList.add("sucesso");
      status.textContent = "Conteúdo copiado para a área de transferência.";
      window.setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("sucesso");
      }, 1200);
    } catch (erro) {
      status.textContent = "Não foi possível copiar. Verifique a permissão da área de transferência do navegador.";
    }
  }

  function valoresPorLinha() { return obterValores({ mascara: chkMascara.checked }); }

  entrada.addEventListener("input", atualizarTexto);
  document.querySelectorAll("input[name='tipo']").forEach(radio => radio.addEventListener("change", atualizarTexto));
  chkValidar.addEventListener("change", atualizarTexto);
  chkRemoverDuplicados.addEventListener("change", atualizarTexto);
  chkMascara.addEventListener("change", atualizarTexto);

  document.getElementById("btn-copiar").addEventListener("click", () =>
    copiarDados("btn-copiar", valoresPorLinha().join("\n")));
  document.getElementById("btn-copiar-linha").addEventListener("click", () =>
    copiarDados("btn-copiar-linha", valoresPorLinha().join(", ")));
  document.getElementById("btn-copiar-virgula").addEventListener("click", () =>
    copiarDados("btn-copiar-virgula", valoresPorLinha().map(v => `${v},`).join("\n")));
  document.getElementById("btn-copiar-sql-lista").addEventListener("click", () => {
    const valores = valoresPorLinha().map(v => `'${v.replace(/'/g, "''")}'`);
    copiarDados("btn-copiar-sql-lista", valores.join(", "));
  });
  document.getElementById("btn-limpar").addEventListener("click", () => {
    entrada.value = "";
    atualizarTexto();
    entrada.focus();
  });

  // Ctrl+Enter processa/recalcula; Esc limpa a entrada.
  entrada.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      atualizarTexto();
    } else if (event.key === "Escape") {
      entrada.value = "";
      atualizarTexto();
    }
  });
  atualizarTexto();
});
