// Execute before importing App/Excalidraw so FontFace constructors always use local assets.
(window as Window & {EXCALIDRAW_ASSET_PATH?:string}).EXCALIDRAW_ASSET_PATH = window.location.origin + '/';
