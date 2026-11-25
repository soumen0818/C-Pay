export const MediaTypeOptions = {
  All: 'All',
  Videos: 'Videos',
  Images: 'Images',
};

export const requestMediaLibraryPermissionsAsync = jest.fn(async () => ({ status: 'granted', granted: true }));
export const requestCameraPermissionsAsync = jest.fn(async () => ({ status: 'granted', granted: true }));
export const launchImageLibraryAsync = jest.fn(async () => ({
  canceled: false,
  assets: [{ uri: 'file:///mock/image.jpg', width: 200, height: 200 }],
}));
export const launchCameraAsync = jest.fn(async () => ({
  canceled: false,
  assets: [{ uri: 'file:///mock/camera.jpg', width: 200, height: 200 }],
}));

export default {
  MediaTypeOptions,
  requestMediaLibraryPermissionsAsync,
  requestCameraPermissionsAsync,
  launchImageLibraryAsync,
  launchCameraAsync,
};
