export class Wave {
  constructor(text, options = {}) {
    this.text = text;
    this.fontSize = options.fontSize || 18;
  }

  create() {
    const wrapper = document.createElement("span");
    wrapper.style.whiteSpace = "pre"; // to preserve spaces and line breaks

    for (let i = 0; i < this.text.length; i++) {
      const span = document.createElement("span");
      span.textContent = this.text[i];
      span.style.display = "inline-block";
      span.style.fontWeight = "600";
      span.style.fontSize = this.fontSize + "px";
      this.bounce(span, i);
      wrapper.appendChild(span);
    }

    return wrapper;
  }

  bounce(el, index = 0) {
    let start = 0;
    const amplitude = this.fontSize * 0.17; // scale bounce height with font size
    const speed = 0.005;
    const phaseShift = index * 0.5;

    const animate = (timestamp) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const y = Math.sin(elapsed * speed + phaseShift) * amplitude;
      el.style.transform = `translateY(${y}px)`;
      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }
}