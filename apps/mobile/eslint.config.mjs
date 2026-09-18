import raiz from '../../eslint.config.mjs';

export default [...raiz, { ignores: ['.expo/**', 'android/**', 'ios/**', 'expo-env.d.ts'] }];
