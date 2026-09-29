/**
 * C13 — o vídeo do passo a passo, embutido no cartão da conta.
 *
 * O endereço já chega conferido (`conferirVideo`): só o player do YouTube (sem
 * cookies), do Vimeo ou do Loom. Sem vídeo configurado, o cartão não desenha
 * nada — os passos escritos continuam ali.
 */
export function VideoDoPassoAPasso({ endereco, titulo }: { endereco: string; titulo: string }) {
  if (endereco === '') return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{titulo}</p>
      <div className="aspect-video w-full overflow-hidden rounded-xl border bg-black">
        <iframe
          src={endereco}
          title={titulo}
          loading="lazy"
          allow="fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full border-0"
        />
      </div>
    </div>
  );
}
