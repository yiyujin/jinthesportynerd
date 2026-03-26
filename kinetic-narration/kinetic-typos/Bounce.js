export class Bounce {
  constructor(str, options = {}) {
    this.str = str || "";
    this.fontSize = options.fontSize || 18;
    this.speed = options.speed || 1.2;
    this.primaryColor = options.primaryColor || "white";
    this.shadowColor = options.shadowColor || "#f5b326";
  }

  create() {
    const wrapper = document.createElement("span");
    wrapper.style.display = "inline-block";
    wrapper.style.fontFamily = "monospace";
    wrapper.style.fontWeight = "700";
    wrapper.style.whiteSpace = "nowrap";
    wrapper.style.lineHeight = "1";
    wrapper.style.verticalAlign = "middle";
    wrapper.style.position = "relative";

    this.characters = [];

    for (let i = 0; i < this.str.length; i++) {
      const charWrapper = document.createElement("span");
      charWrapper.style.display = "inline-block";
      charWrapper.style.position = "relative";
      charWrapper.style.width = this.fontSize * 0.55 + "px";
      charWrapper.style.height = this.fontSize + "px";
      charWrapper.style.verticalAlign = "baseline";

      const char1 = document.createElement("span");
      char1.textContent = this.str[i];
      char1.style.position = "absolute";
      char1.style.left = "50%";
      char1.style.bottom = "0";
      char1.style.transform = "translateX(-50%)";
      char1.style.color = this.shadowColor;
      char1.style.fontSize = this.fontSize + "px";
      char1.style.lineHeight = "1";
      char1.style.transformOrigin = "center bottom";

      const char2 = document.createElement("span");
      char2.textContent = this.str[i];
      char2.style.position = "absolute";
      char2.style.left = "50%";
      char2.style.bottom = "0";
      char2.style.transform = "translateX(-50%)";
      char2.style.color = this.primaryColor;
      char2.style.fontSize = this.fontSize + "px";
      char2.style.lineHeight = "1";
      char2.style.transformOrigin = "center bottom";

      charWrapper.appendChild(char1);
      charWrapper.appendChild(char2);
      wrapper.appendChild(charWrapper);

      this.characters.push({ element: char1, index: i, freq: 1 });
      this.characters.push({ element: char2, index: i, freq: 3 });
    }

    this.startAnimation();
    return wrapper;
  }

  startAnimation() {
    let startTime = null;
    const degToRad = (deg) => (deg * Math.PI) / 180;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const frameCount = (timestamp - startTime) * 0.06;

      this.characters.forEach(({ element, index, freq }) => {
        const angleDeg = -(index + 1) * freq + frameCount * this.speed;
        const angleRad = degToRad(angleDeg);

        let motion = Math.abs(Math.cos(angleRad) * this.fontSize * 1.5);
        motion = Math.max(0, Math.min(motion, this.fontSize));

        element.style.fontSize = motion + "px";
      });

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }
}