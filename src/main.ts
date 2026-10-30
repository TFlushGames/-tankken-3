import { App } from './game/app';
import './game/style.css';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
new App(canvas, ui);
