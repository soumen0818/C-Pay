export const requestPermissionsAsync = jest.fn(async () => ({ status: 'granted', granted: true }));
export const getPermissionsAsync = jest.fn(async () => ({ status: 'granted', granted: true }));
export const saveToLibraryAsync = jest.fn(async () => true);
export const createAssetAsync = jest.fn(async (uri: string) => ({ id: 'mock-asset', uri }));

export default {
  requestPermissionsAsync,
  getPermissionsAsync,
  saveToLibraryAsync,
  createAssetAsync,
};
