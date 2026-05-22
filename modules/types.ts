export interface DataSourceModule {
  id: string;
  name: string;
  description: string;
  metricsProvided: string[];
  settings: {
    key: string;
    label: string;
    type: 'text' | 'password' | 'number' | 'boolean' | 'file';
    description?: string;
  }[];
  sync: (userId: number, db: any, logEvent: Function, userSettings: any, data?: any) => Promise<{ success: boolean, message: string, [key: string]: any }>;
  purge: (userId: number, db: any, userSettings: any) => Promise<{ success: boolean, message: string }>;
}
