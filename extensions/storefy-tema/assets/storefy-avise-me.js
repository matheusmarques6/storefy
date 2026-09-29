/*
 * O botão "me avise quando voltar" (seção 6 do plano).
 *
 * Roda na página de produto da loja do cliente. Ele só aparece DENTRO do app,
 * e só num app com notificações: a inscrição é por aparelho, e o aviso é um
 * push. No navegador, o elemento continua escondido e o visitante não vê
 * promessa nenhuma que não possamos cumprir.
 *
 * Quem fala com o servidor é o APP, e não este script: `window.Storefy`
 * entrega a mensagem à camada nativa, que assina a requisição com o segredo do
 * app. Um `fetch` daqui para a nossa API seria uma chamada sem assinatura,
 * vinda da página do lojista — ou seja, de qualquer um.
 *
 * "PRONTO" SÓ COM A RESPOSTA DO APP. Entregar a mensagem não é gravar o
 * pedido: o app ainda pede a permissão de notificação e fala com o servidor.
 * O botão espera o `NOTIFY_WHEN_BACK_RESULT` e diz o que aconteceu — pronto,
 * onde ligar as notificações, ou que dá para tentar de novo.
 */
(function () {
  'use strict';

  /*
   * Quanto esperar pela resposta. Longo de propósito: no primeiro toque, o
   * app mostra o pedido de permissão do sistema, e a pessoa pode demorar para
   * responder. Uma resposta que chega depois do prazo ainda vale.
   */
  var ESPERA_MS = 20000;
  var RESPOSTA = 'NOTIFY_WHEN_BACK_RESULT';

  try {
    if (window.__STOREFY_AVISE_ME__) return;
    window.__STOREFY_AVISE_ME__ = true;

    // Fora do app, ou num app sem notificações, não há como avisar.
    var contexto = window.__STOREFY__;
    if (!contexto || contexto.pushEnabled !== true || !window.Storefy) return;

    var botoes = [];
    var caixas = document.querySelectorAll('[data-storefy-avise-me]');
    for (var i = 0; i < caixas.length; i++) {
      var montado = montar(caixas[i]);
      if (montado) botoes.push(montado);
    }
    if (botoes.length === 0) return;

    // Uma escuta só, para todos os botões da página: cada um é da sua variante.
    window.addEventListener('message', function (evento) {
      var resposta = lerResposta(evento && evento.data);
      if (!resposta) return;
      for (var j = 0; j < botoes.length; j++) {
        if (botoes[j].variante === resposta.variantId) botoes[j].terminar(resposta);
      }
    });
  } catch (e) {
    /* Uma exceção nossa não pode virar bug na loja do cliente. */
  }

  /** A resposta do app, ou `null` para qualquer outra mensagem da página. */
  function lerResposta(dados) {
    if (typeof dados !== 'string' || dados.indexOf(RESPOSTA) < 0) return null;
    try {
      var lido = JSON.parse(dados);
      if (!lido || lido.type !== RESPOSTA || typeof lido.variantId !== 'string') return null;
      return lido;
    } catch (e) {
      return null;
    }
  }

  function montar(caixa) {
    var variante = caixa.getAttribute('data-variante') || '';
    if (!variante) return null;

    var caminho = caixa.getAttribute('data-caminho') || '';
    var rotulo = caixa.getAttribute('data-rotulo') || 'Me avise quando voltar';
    var confirmacao = caixa.getAttribute('data-confirmacao') || 'Pronto! Você será avisado.';
    var textoDoErro =
      caixa.getAttribute('data-erro') || 'Não deu certo agora. Toque para tentar de novo.';
    var textoSemPermissao =
      caixa.getAttribute('data-sem-permissao') ||
      'Para receber o aviso, ative as notificações deste app nos ajustes do celular.';

    var botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = rotulo;
    botao.style.cssText = [
      'width:100%',
      'padding:12px 16px',
      'border:1px solid currentColor',
      'border-radius:8px',
      'background:transparent',
      'color:inherit',
      'font:inherit',
      'font-weight:600',
      'cursor:pointer',
    ].join(';');

    // O que aconteceu, dito em voz alta para quem usa leitor de tela.
    var aviso = document.createElement('p');
    aviso.setAttribute('role', 'status');
    aviso.style.cssText = 'margin:8px 0 0;font-size:0.9em';

    var relogio = null;

    function liberar() {
      botao.disabled = false;
      botao.removeAttribute('aria-busy');
      botao.textContent = rotulo;
      botao.style.opacity = '';
      botao.style.cursor = 'pointer';
    }

    function terminar(resposta) {
      if (relogio !== null) {
        window.clearTimeout(relogio);
        relogio = null;
      }
      if (resposta.ok === true) {
        botao.disabled = true;
        botao.removeAttribute('aria-busy');
        botao.textContent = confirmacao;
        botao.style.opacity = '0.7';
        botao.style.cursor = 'default';
        aviso.textContent = '';
        return;
      }
      liberar();
      aviso.textContent = resposta.reason === 'permission' ? textoSemPermissao : textoDoErro;
    }

    botao.addEventListener('click', function () {
      if (botao.disabled) return;
      /*
       * O retorno diz se a mensagem CHEGOU ao app. Se não chegou, o botão
       * fica como está: não há o que esperar.
       */
      var entregue = window.Storefy.notifyWhenBack(variante, caminho);
      if (!entregue) return;

      botao.disabled = true;
      botao.setAttribute('aria-busy', 'true');
      botao.style.opacity = '0.7';
      botao.style.cursor = 'default';
      aviso.textContent = '';
      relogio = window.setTimeout(function () {
        relogio = null;
        terminar({ ok: false, reason: 'unavailable' });
      }, ESPERA_MS);
    });

    caixa.hidden = false;
    caixa.appendChild(botao);
    caixa.appendChild(aviso);
    return { variante: variante, terminar: terminar };
  }
})();
