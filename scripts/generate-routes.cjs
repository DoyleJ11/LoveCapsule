const fs = require('node:fs');
process.env.EXPO_ROUTER_APP_ROOT = 'app';
fs.mkdirSync('.expo/types', { recursive: true });
require('expo-router/build/typed-routes').regenerateDeclarations('.expo/types');
