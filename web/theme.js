/* apply a saved light/dark choice before the page paints */
try{var t=JSON.parse(localStorage.getItem("poulet-v5theme"));if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}
