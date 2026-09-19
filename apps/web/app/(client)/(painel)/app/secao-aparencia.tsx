'use client';

/** Cores e barra de status (C06a). */
import type { AppConfig } from '@storefy/config-schema';
import { CampoDeCor } from './campo-de-cor';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { editarTema } from '@/lib/editor-de-config';

const CORES: { campo: keyof AppConfig['theme']; rotulo: string; ajuda: string }[] = [
  { campo: 'primary', rotulo: 'Cor principal', ajuda: 'Botões, selos e destaques do app.' },
  { campo: 'background', rotulo: 'Fundo', ajuda: 'Fundo das telas nativas do app.' },
  { campo: 'text', rotulo: 'Texto', ajuda: 'Títulos e textos das telas nativas.' },
  { campo: 'tabBarBg', rotulo: 'Fundo da barra de abas', ajuda: 'A faixa embaixo da tela.' },
  {
    campo: 'tabBarActive',
    rotulo: 'Aba selecionada',
    ajuda: 'Cor do ícone e do nome da aba aberta.',
  },
  { campo: 'tabBarInactive', rotulo: 'Abas não selecionadas', ajuda: 'As outras abas da barra.' },
];

export function SecaoAparencia({
  config,
  aoMudar,
  somenteLeitura,
}: {
  config: AppConfig;
  aoMudar: (config: AppConfig) => void;
  somenteLeitura: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {CORES.map(({ campo, rotulo, ajuda }) => (
          <CampoDeCor
            key={campo}
            id={`cor-${campo}`}
            rotulo={rotulo}
            ajuda={ajuda}
            valor={config.theme[campo]}
            desabilitado={somenteLeitura}
            aoMudar={(valor) => {
              aoMudar(editarTema(config, { [campo]: valor }));
            }}
          />
        ))}
      </div>

      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="barra-de-status">Barra de status</Label>
        <Select
          id="barra-de-status"
          value={config.theme.statusBar}
          disabled={somenteLeitura}
          onChange={(evento) => {
            aoMudar(
              editarTema(config, {
                statusBar: evento.target.value === 'light' ? 'light' : 'dark',
              }),
            );
          }}
        >
          <option value="dark">Ícones escuros (para fundo claro)</option>
          <option value="light">Ícones claros (para fundo escuro)</option>
        </Select>
        <p className="text-muted-foreground text-xs">
          É a faixa do topo do celular, com a hora e a bateria. Escolha o que contrasta com o seu
          fundo.
        </p>
      </div>
    </div>
  );
}
