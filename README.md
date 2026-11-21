Extrator de Números -- Chrome 1.9.4
Base: Extrator de Números v1.8.6 Chrome AutoChooser.
Nova função opcional: Google Drive
A versão 1.9.4 adiciona o botão Enviar para Google Drive. A gravação
continua sendo feita localmente no navegador; o upload só acontece
quando o usuário clicar no botão.

O fluxo é:
1. Gravar o vídeo normalmente.
2. Clicar em Enviar para Google Drive.
3. Na primeira utilização, o Chrome solicita a autenticação/autorização
   da conta Google.
4. A extensão procura a pasta Ext-gravações de tela na raiz do
   Google Drive.
5. Se a pasta não existir, a extensão cria automaticamente essa pasta.
6. O vídeo é enviado para a pasta Ext-gravações de tela.
7. A extensão cria uma permissão de leitura do tipo "qualquer pessoa
   com o link".
8. A extensão mostra Copiar link e Abrir.
Pasta de destino
Todos os vídeos enviados pela extensão são organizados na pasta:

Ext-gravações de tela

A pasta é criada automaticamente na raiz do Google Drive caso ainda não
exista. Nos envios seguintes, a extensão reutiliza a mesma pasta.
Escopo utilizado
A extensão usa somente:

https://www.googleapis.com/auth/drive.file

Esse escopo é propositalmente mais restrito que drive: a extensão
trabalha com arquivos criados por ela, em vez de solicitar acesso geral
aos arquivos existentes do Drive.
Configuração obrigatória do desenvolvedor
Antes de distribuir a extensão com a função Google Drive, configure um
projeto no Google Cloud e crie um OAuth Client ID para Chrome
Extension, associado ao ID da extensão publicada na Chrome Web Store.

O manifest.json desta versão deve estar configurado com o OAuth Client
ID associado à extensão publicada. Se o ID da extensão publicada mudar
no futuro, será necessário criar/associar um novo OAuth Client ID
correspondente.

Também é necessário habilitar a Google Drive API no projeto.

Sem esse Client ID configurado, a gravação local continua funcionando,
mas o botão de envio não conseguirá autenticar.
Privacidade
O vídeo não é enviado automaticamente. O upload só ocorre após o usuário
clicar em Enviar para Google Drive e autorizar a conta Google. A
extensão não solicita nem armazena a senha da conta.

Ao concluir o upload, a extensão solicita uma permissão de leitura do
tipo qualquer pessoa com o link para permitir o compartilhamento
direto do vídeo.
Correção do upload -- 1.9.3
- Upload do Google Drive migrado para o protocolo resumable.
- Removido o multipart com boundary não-ASCII que podia causar HTTP
  400.
- Renovação automática do token em caso de HTTP 401.
- Falha no compartilhamento público agora é informada separadamente do
  upload.
Ajuste de layout -- 1.9.3
Após o envio para o Google Drive, a janela é ampliada automaticamente
para exibir integralmente o status e os botões de compartilhamento
(Copiar link / Abrir), sem cortar a área inferior.
Organização dos arquivos no Google Drive -- 1.9.4
- Os vídeos não são mais enviados diretamente para a raiz do Google
  Drive.
- A extensão utiliza a pasta Ext-gravações de tela como destino.
- A pasta é criada automaticamente caso não exista.
- Os próximos vídeos são enviados para a mesma pasta.