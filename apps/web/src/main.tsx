import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './theme.css';
import './frame/frame.css';

const Application=React.lazy(()=>window.location.pathname.startsWith('/live')?import('./live/LiveApp').then(m=>({default:m.LiveApp})):import('./FrameApp').then(m=>({default:m.FrameApp})));
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><React.Suspense fallback={<p className="p-6 text-sm">화면을 불러오고 있습니다.</p>}><Application/></React.Suspense></BrowserRouter></React.StrictMode>);
