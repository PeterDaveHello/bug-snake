module.exports = {
  extends: ['stylelint-config-recommended'],
  rules: {
    'function-no-unknown': [true, { ignoreFunctions: ['env'] }],
    'no-descending-specificity': null
  }
};
