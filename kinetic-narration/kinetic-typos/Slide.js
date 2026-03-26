export class Slide {
  constructor(str, options = {}) {
    this.str = str;
    this.fontSize = options.fontSize || 24;
    this.colors = ['#AF50FF', '#00BEFF', '#FF685F', '#F7C839', '#FF3E0D', '#FD9540', '#F7C839', '#00D37E'];
    this.container = document.createElement("span");
    this.container.style.lineHeight = "1.2";
    this.container.style.fontWeight = "bold";
    this.container.style.fontSize = this.fontSize + "px";

    this.render();
  }

  render() {
    const regex = /<slide>(.*?)<\/slide>/g;
    let lastIndex = 0;
    let match;
    const slotHeight = Math.round(this.fontSize * 1.2);

    while ((match = regex.exec(this.str)) !== null) {
      if (match.index > lastIndex) {
        this.container.appendChild(document.createTextNode(this.str.slice(lastIndex, match.index)));
      }

      const wrapper = document.createElement("span");
      wrapper.style.display = "inline-block";
      wrapper.style.verticalAlign = "top";
      this.container.appendChild(wrapper);

      const chars = match[1].split("");

      const charWraps = chars.map((ch) => {
        const charWrap = document.createElement("span");
        charWrap.style.overflow = "hidden";
        charWrap.style.display = "inline-block";
        charWrap.style.verticalAlign = "top";
        charWrap.style.height = slotHeight + "px";

        const inner = document.createElement("span");
        inner.style.display = "flex";
        inner.style.flexDirection = "column";
        inner.style.transform = "translateY(0)";
        // inner.style.transition = "transform 0.4s ease";

// Instead of hardcoding 0.4s, scale it down for larger font sizes
const transDuration = Math.max(0.15, 0.4 * (14 / this.fontSize));
inner.style.transition = `transform ${transDuration}s ease`;

        inner.style.willChange = "transform";
        inner.style.fontWeight = "bold";
        inner.style.fontSize = this.fontSize + "px";

        const top = document.createElement("span");
        const bottom = document.createElement("span");

        if (ch === " ") {
          top.innerHTML = "&nbsp;";
          bottom.innerHTML = "&nbsp;";
        } else {
          top.textContent = ch;
          bottom.textContent = ch;
        }

        inner.appendChild(top);
        inner.appendChild(bottom);
        charWrap.appendChild(inner);
        wrapper.appendChild(charWrap);

        return inner;
      });

      let showingBottom = false;

      const tick = () => {
        charWraps.forEach((inner, i) => {
          setTimeout(() => {
            inner.style.transform = showingBottom ? "translateY(0)" : "translateY(-52%)";
          }, i * 30);
        });
        showingBottom = !showingBottom;
      };

      // Only start the interval once the element is actually in the DOM
      // so that CSS transitions have a live element to fire against.
      const waitForDOM = () => {
        if (wrapper.isConnected) {
          tick(); // fire immediately so it doesn't wait one full interval before starting
          setInterval(tick, chars.length * 80);
        } else {
          requestAnimationFrame(waitForDOM);
        }
      };
      requestAnimationFrame(waitForDOM);

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < this.str.length) {
      this.container.appendChild(document.createTextNode(this.str.slice(lastIndex)));
    }
  }

  renderElement() {
    return this.container;
  }
}