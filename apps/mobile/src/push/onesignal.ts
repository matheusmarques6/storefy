/**
 * A única porta para o SDK do OneSignal.
 *
 * Todo o resto do app fala com esta interface, e não com o módulo nativo.
 * Não é cerimônia: o SDK só existe dentro de um build nativo, então qualquer
 * arquivo que o importe deixa de ser testável — e a decisão de QUANDO pedir
 * permissão, PARA ONDE levar um toque e O QUE marcar como tag é justamente o
 * que precisa de teste. Aqui embaixo não há decisão nenhuma; é tradução.
 */
import { OneSignal, type NotificationClickEvent } from 'react-native-onesignal';
import type { NotificacaoRecebida } from './deep-link.ts';

/** O que o app precisa que o SDK faça. */
export interface Notificador {
  iniciar: (appId: string) => void;
  /** ID de inscrição deste aparelho. `null` até o SDK registrar. */
  idDaInscricao: () => Promise<string | null>;
  temPermissao: () => Promise<boolean>;
  /** Ainda dá para mostrar o pedido do sistema? */
  podePedir: () => Promise<boolean>;
  pedirPermissao: () => Promise<boolean>;
  identificar: (externalId: string) => void;
  esquecerIdentificacao: () => void;
  marcar: (tags: Record<string, string>) => void;
  /** Avisa quando o cliente toca numa notificação. */
  aoTocar: (ouvinte: (notificacao: NotificacaoRecebida) => void) => void;
  /** Avisa quando o ID de inscrição aparece ou muda. */
  aoMudarInscricao: (ouvinte: (id: string | null) => void) => void;
}

export const notificadorReal: Notificador = {
  iniciar: (appId) => {
    OneSignal.initialize(appId);
  },
  idDaInscricao: () => OneSignal.User.pushSubscription.getIdAsync(),
  temPermissao: () => OneSignal.Notifications.getPermissionAsync(),
  podePedir: () => OneSignal.Notifications.canRequestPermission(),
  /*
   * `fallbackToSettings: false`. Com `true`, quem já recusou é jogado nos
   * Ajustes do aparelho sem aviso — sai do app, se perde, e não volta. Quem
   * já recusou é atendido pela tela de ajustes do app (M12), que explica
   * antes de mandar para lá.
   */
  pedirPermissao: () => OneSignal.Notifications.requestPermission(false),
  identificar: (externalId) => {
    OneSignal.login(externalId);
  },
  esquecerIdentificacao: () => {
    OneSignal.logout();
  },
  marcar: (tags) => {
    OneSignal.User.addTags(tags);
  },
  aoTocar: (ouvinte) => {
    OneSignal.Notifications.addEventListener('click', (evento: NotificationClickEvent) => {
      ouvinte(evento.notification);
    });
  },
  aoMudarInscricao: (ouvinte) => {
    OneSignal.User.pushSubscription.addEventListener('change', (evento) => {
      ouvinte(evento.current.id ?? null);
    });
  },
};
