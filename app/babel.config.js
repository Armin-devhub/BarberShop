module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // react-native-worklets/plugin must be the LAST plugin (required by
    // Reanimated v4 in Expo SDK 54).
    plugins: ['react-native-worklets/plugin']
  };
};
