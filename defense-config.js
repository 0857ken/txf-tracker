(function (root) {
  'use strict';
  const config = Object.freeze({
    mode: 'preview',
    strategyId: '0050-defense-v1',
    previewId: '0050-defense-candidate-v1',
    forwardStart: '2026-09-16',
    formulaVersion: 'forward-candidate-v3',
    capitalBase: 2000000,
    noTradeBand: 0.05,
    safetyPercent: 500,
    restorePercent: 550
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  else root.DefenseConfig = config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
