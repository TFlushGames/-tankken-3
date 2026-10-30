import { App } from './game/app';
import './game/style.css';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const app = new App(canvas, ui);
// Uchwyt do testów automatycznych (?debug).
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { tk: App }).tk = app;
