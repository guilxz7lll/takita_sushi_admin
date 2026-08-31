const bloqueio = document.getElementById("bloqueio");

// ligar (fechar o site)
function fecharSite() {
  bloqueio.style.display = "block";
}

// desligar (abrir de novo)
function abrirSite() {
  bloqueio.style.display = "none";
}