/// <reference types="vite/client" />
import { mount } from "svelte";
import App from "./App.svelte";
import "./settings.css";

mount(App, { target: document.getElementById("app")! });
