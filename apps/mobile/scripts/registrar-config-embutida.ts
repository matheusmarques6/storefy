/**
 * Uso (na raiz do repositório): `pnpm exec tsx apps/mobile/scripts/registrar-config-embutida.ts <loja>`
 *
 * Chamado pelo workflow `build-store-app.yml` depois de gravar
 * `brands/<loja>/config.json`. Ver `src/config/registro-embutido.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registrarConfigEmbutida } from '../src/config/registro-embutido.ts';

const storeId = process.argv[2] ?? '';
const arquivo = join(import.meta.dirname, '..', 'src', 'config', 'embutida.ts');

writeFileSync(arquivo, registrarConfigEmbutida(readFileSync(arquivo, 'utf8'), storeId));
console.log(`config embutida registrada para ${storeId}`);
