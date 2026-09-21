/*
 * O botão "me avise quando voltar" (seção 6 do plano).
 *
 * Roda na página de produto da loja do cliente. Ele só aparece DENTRO do app:
 * a inscrição é por aparelho, e aparelho só existe onde o app está instalado.
 * No navegador, o elemento continua escondido e o visitante não vê promessa
 * nenhuma que não possamos cumprir.
 *
 * Quem fala com o servidor é o APP, e não este script: `window.Storefy`
 * entrega a mensagem à camada nativa, que assina a requisição com o segredo do
 * app. Um `fetch` daqui para a nossa API seria uma chamada sem assinatura,
 * vinda da página do lojista — ou seja, de qualquer um.
 */
(function () {
  'use strict';

  try {
    if (window.__STOREFY_AVISE_ME__) return;
    window.__STOREFY_AVISE_ME__ = true;

    // Fora do app não há para onde mandar a notificação.
    if (!window.__STOREFY__ || !window.Storefy) return;

    var caixas = document.querySelectorAll('[data-storefy-avise-me]');
    for (var i = 0; i < caixas.length; i++) {
      montar(caixas[i]);
    }
  } catch (e) {
    /* Uma exceção nossa não pode virar bug na loja do cliente. */
  }

  function montar(caixa) {
    var variante = caixa.getAttribute('data-variante') || '';
    if (!variante) return;

    var caminho = caixa.getAttribute('data-caminho') || '';
    var rotulo = caixa.getAttribute('data-rotulo') || 'Me avise quando voltar';
    var confirmacao = caixa.getAttribute('data-confirmacao') || 'Pronto! Você será avisado.';

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

    botao.addEventListener('click', function () {
      /*
       * O retorno diz se a mensagem CHEGOU ao app, e não se o servidor gravou.
       * Se não chegou, o botão volta ao normal em vez de mentir um "pronto".
       */
      var entregue = window.Storefy.notifyWhenBack(variante, caminho);
      if (!entregue) return;

      botao.disabled = true;
      botao.textContent = confirmacao;
      botao.style.opacity = '0.7';
      botao.style.cursor = 'default';
    });

    caixa.hidden = false;
    caixa.appendChild(botao);
  }
})();
