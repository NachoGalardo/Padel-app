module.exports = {
  Platform: { OS: 'ios' },
  NativeModules: {},
  NativeEventEmitter: function () {
    return { addListener: () => {}, removeListener: () => {} };
  },
};

