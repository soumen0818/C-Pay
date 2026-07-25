const { getDefaultConfig } = require('expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

defaultConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@noble/hashes/crypto.js') {
    return context.resolveRequest(context, '@noble/hashes/crypto', platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = defaultConfig;
