import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { StartupApp } from './StartupApp';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#237f70', borderRadius: 5, fontSize: 13, fontFamily: '"Segoe UI","Microsoft YaHei",sans-serif', colorBgContainer: '#ffffff' } }}>
    <AntApp><StartupApp /></AntApp>
  </ConfigProvider>
);
