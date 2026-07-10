export type NotificationPort = {
  sendUserAlert(userId: string, message: string): Promise<void>;
};
