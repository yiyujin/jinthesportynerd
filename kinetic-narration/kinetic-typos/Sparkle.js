export class Sparkle {
  constructor(text, options = {}) {
    this.text = text;
    this.fontSize = options.fontSize || 18;

    if (!document.getElementById("sparkle-style")) {
      const style = document.createElement("style");
      style.id = "sparkle-style";
      style.textContent = `
        .sparkle-container { position: relative; display: inline-block; }
        .sparkle { position: absolute; width: 20px; height: 20px; background-color: #fcba28; clip-path: polygon(64.86% 8.93%,68.92% 48.21%,100% 53.57%,68.92% 58.93%,64.86% 100%,59.46% 58.93%,31.08% 53.57%,59.46% 48.21%); opacity:0; pointer-events:none; }
        .sparkle-text { background: -webkit-linear-gradient(#fff,#fcba28); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; }
        @keyframes sparkle-animation { 0% {opacity:0; transform:scale(0.5) rotate(0deg);} 50% {opacity:1; transform:scale(1) rotate(180deg);} 100% {opacity:0; transform:scale(1) rotate(360deg);} }
      `;
      document.head.appendChild(style);
    }
  }

  render() {
    const container = document.createElement("span");
    container.className = "sparkle-container";

    const textSpan = document.createElement("span");
    textSpan.className = "sparkle-text";
    textSpan.textContent = this.text;
    textSpan.style.fontSize = this.fontSize + "px";
    container.appendChild(textSpan);

    for (let i = 0; i < 2; i++) {
      const sparkle = document.createElement("span");
      sparkle.className = "sparkle";
      container.appendChild(sparkle);
    }

    this.initSparkles(container);
    return container;
  }

  initSparkles(container) {
    const sparkles = container.querySelectorAll(".sparkle");
    const textEl = container.querySelector(".sparkle-text");

    const randomPos = () => ({ top: Math.random() * textEl.offsetHeight, left: Math.random() * textEl.offsetWidth });

    const position = (el) => {
      const { top, left } = randomPos();
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
      el.style.animationDuration = (Math.random() * 1.5 + 1).toFixed(2) + "s";
      el.style.animationName = "sparkle-animation";
      el.style.opacity = "1";
    };

    sparkles.forEach(el => {
      el.addEventListener("animationend", () => {
        el.style.opacity = "0";
        el.style.animationName = "none";
        el.offsetHeight;
        el.style.animationName = "sparkle-animation";
        position(el);
      });
      position(el);
    });
  }
}