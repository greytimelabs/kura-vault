// Geometry for the Kura Vault mark on a 1024 grid. Shared by every variant.
export const C = {
  indigo: '#233A5E',
  plaster: '#F2ECE1',
  ink: '#141A24',
  indigoLight: '#9FB4D6',
};

// Concave Japanese gable roof with flat eave band.
export const ROOF =
  'M484 200 H540 Q616 318 836 362 V418 H188 V362 Q408 318 484 200 Z';

// Plastered body with keyhole door cut out (evenodd).
const BODY = 'M264 446 H760 V824 H264 Z';
const KEYHOLE =
  'M484 663.5 A72 72 0 1 1 540 663.5 L568 764 L456 764 Z';
export const BODY_WITH_DOOR = `${BODY} ${KEYHOLE}`;

// The mark as SVG elements, filled with `fill`. `scale`/`dx`/`dy` let callers
// place it on other canvases.
export function markGroup(fill, { scale = 1, dx = 0, dy = 0 } = {}) {
  const t = scale === 1 && !dx && !dy ? '' : ` transform="translate(${dx} ${dy}) scale(${scale})"`;
  return `<g fill="${fill}"${t}><path d="${ROOF}"/><path fill-rule="evenodd" d="${BODY_WITH_DOOR}"/></g>`;
}
