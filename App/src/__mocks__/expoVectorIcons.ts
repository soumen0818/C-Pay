import React from 'react';

export const Ionicons = (props: any) => {
  return React.createElement('Ionicons', props, props.children);
};
export const MaterialIcons = (props: any) => {
  return React.createElement('MaterialIcons', props, props.children);
};
export const FontAwesome = (props: any) => {
  return React.createElement('FontAwesome', props, props.children);
};
export const Feather = (props: any) => {
  return React.createElement('Feather', props, props.children);
};
export default { Ionicons, MaterialIcons, FontAwesome, Feather };
