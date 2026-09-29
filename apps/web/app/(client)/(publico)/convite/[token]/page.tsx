/**
 * C16 — o convite, para quem recebeu o link.
 *
 * Quatro caminhos, conforme quem abre:
 *   sem conta com aquele e-mail → cria a conta ali mesmo (vale com o
 *     cadastro fechado: o convite é a porta);
 *   com conta, sem sessão → entra e volta para cá;
 *   com a sessão do e-mail certo → um botão, "Aceitar";
 *   com a sessão de OUTRO e-mail → explica e oferece trocar de conta.
 *
 * O Google não aparece aqui: ele cria a conta sem passar o convite adiante, e
 * com o cadastro fechado o banco a recusaria.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { MailX, UserPlus } from 'lucide-react';
import { ROTULO_PAPEL } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import {
  O_QUE_O_PAPEL_PODE,
  ROTULO_PAPEL_NA_PLATAFORMA,
  mensagemDoAceite,
  segredoTemFormato,
  situacaoDoConvite,
} from '@/lib/convites';
import { FUSO_PADRAO, formatarData } from '@/lib/fuso';
import { AceitarConvite, CadastroPeloConvite, TrocarDeConta } from './formularios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { lido } from '@/lib/leitura';

export const metadata: Metadata = { title: 'Convite' };

export default async function PaginaDoConvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await criarClientServidor();

  const [lidas, sessao] = await Promise.all([
    segredoTemFormato(token)
      ? supabase.rpc('ver_convite', { p_token: token })
      : Promise.resolve({ data: null, error: null }),
    supabase.auth.getUser(),
  ]);
  // O banco fora do ar não é "convite indisponível": a pessoa pediria outro à toa.
  const { data: linhas } = lido(lidas, 'o convite');
  const convite = linhas?.[0] ?? null;
  const situacao = situacaoDoConvite(convite?.situacao);
  // Aqui o erro é o esperado: sem sessão, o `getUser` responde com erro — é o
  // visitante que ainda não entrou, e a tela oferece entrar ou criar a conta.
  const usuario = sessao.data.user;

  if (convite == null || situacao !== 'pendente') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailX className="size-5" aria-hidden />
            {situacao === 'usado' ? 'Convite já usado' : 'Convite indisponível'}
          </CardTitle>
          <CardDescription>
            {mensagemDoAceite(situacao === 'pendente' ? 'inexistente' : situacao)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href={usuario == null ? '/entrar' : '/'}>
              {usuario == null ? 'Entrar' : 'Ir para o painel'}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const email = convite.email ?? '';
  const convidadoPor = convite.convidado_por ?? 'Alguém';
  const titulo =
    convite.tipo === 'organizacao'
      ? `Convite para a equipe de ${convite.organizacao ?? 'uma empresa'}`
      : convite.tipo === 'conta'
        ? 'Convite para criar sua conta na Storefy'
        : 'Convite para a equipe da Storefy';

  const papel =
    convite.tipo === 'organizacao' && convite.papel != null
      ? `${ROTULO_PAPEL[convite.papel]}: ${O_QUE_O_PAPEL_PODE[convite.papel]}`
      : convite.tipo === 'equipe' && convite.papel_na_plataforma != null
        ? ROTULO_PAPEL_NA_PLATAFORMA[convite.papel_na_plataforma]
        : null;

  const emailDaSessao = usuario?.email?.toLowerCase() ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-5 shrink-0" aria-hidden />
          {titulo}
        </CardTitle>
        <CardDescription>
          {convidadoPor} convidou <span className="text-foreground font-medium">{email}</span>. O
          convite vale até {formatarData(convite.expira_em, FUSO_PADRAO)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {papel === null ? null : (
          <p className="bg-muted rounded-lg px-3 py-2 text-sm">
            <span className="font-medium">Seu papel</span> — {papel}
          </p>
        )}

        {usuario == null ? (
          convite.ja_tem_conta === true ? (
            <div className="space-y-3">
              <p className="text-sm">
                Já existe uma conta com {email}. Entre com ela para aceitar o convite.
              </p>
              <Button asChild className="w-full">
                <Link href={`/entrar?proximo=${encodeURIComponent(`/convite/${token}`)}`}>
                  Entrar e aceitar
                </Link>
              </Button>
            </div>
          ) : (
            <CadastroPeloConvite
              token={token}
              email={email}
              pedeEmpresa={convite.tipo === 'conta'}
            />
          )
        ) : emailDaSessao === email ? (
          <AceitarConvite token={token} />
        ) : (
          <TrocarDeConta token={token} emailDoConvite={email} emailDaSessao={emailDaSessao ?? ''} />
        )}
      </CardContent>
    </Card>
  );
}
