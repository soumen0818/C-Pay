import React from 'react';

const createSvgComponent = (name: string) => {
  const Component = (props: any) => React.createElement(name, props, props.children);
  Component.displayName = name;
  return Component;
};

export const Svg = createSvgComponent('Svg');
export const Circle = createSvgComponent('Circle');
export const Rect = createSvgComponent('Rect');
export const Path = createSvgComponent('Path');
export const G = createSvgComponent('G');
export const Text = createSvgComponent('SvgText');
export const Line = createSvgComponent('Line');
export const Defs = createSvgComponent('Defs');
export const LinearGradient = createSvgComponent('SvgLinearGradient');
export const Stop = createSvgComponent('Stop');
export const ClipPath = createSvgComponent('ClipPath');
export const Polygon = createSvgComponent('Polygon');
export const Polyline = createSvgComponent('Polyline');

export default Svg;
