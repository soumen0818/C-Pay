export const isAvailableAsync = jest.fn(async () => true);
export const shareAsync = jest.fn(async () => ({ action: 'sharedAction' }));
export default { isAvailableAsync, shareAsync };
