import './styles/base.css';
import './styles/app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { warmUpAfterFirstPaint } from './lib/engine';
import { initAnalytics } from './lib/analytics';

const target = document.getElementById('app')!;
target.replaceChildren(); // drop the static empty-state shell
mount(App, { target });

warmUpAfterFirstPaint();
initAnalytics();
