import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

// Detect local server vs GitHub Pages
const BASE_PATH =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "/" // Local server
    : "/EV-Market-Research/"; // GitHub Pages repo name

d3.csv(BASE_PATH + "data/cleaned_ev_data.csv", (d) => ({
  brand: d.brand,
  tier: d.market_segment,
  model: d.model,
  year: +d.year,
  price: +d.price_usd,
})).then((data) => {
  const margin = { top: 20, right: 30, bottom: 40, left: 70 };
  const svgWidth = 600;
  const svgHeight = 400;
  const width = svgWidth - margin.left - margin.right;
  const height = svgHeight - margin.top - margin.bottom;

  const svg = d3
    .select("#line-chart")
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // ---------- Scales ----------
  const [dataMin, dataMax] = d3.extent(data, (d) => d.year);
  const x = d3
    .scaleLinear()
    .domain([dataMin - 0.5, dataMax + 0.5])
    .range([0, width]);

  const minPrice = d3.min(data, (d) => d.price);
  const maxPrice = d3.max(data, (d) => d.price);
  const y = d3
    .scaleLinear()
    .domain([minPrice * 0.95, maxPrice * 1.05])
    .nice()
    .range([height, 0]);

  // ---------- Axes ----------
  svg
    .append("g")
    .attr("transform", `translate(0,${height})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(d3.range(dataMin, dataMax + 1))
        .tickFormat(d3.format("d")),
    );
  svg.append("g").call(d3.axisLeft(y).tickFormat(d3.format("$,")));

  // ---------- Layers (order = stacking order) ----------
  const linesLayer = svg.append("g");
  const pointsLayer = svg.append("g"); // NEW: dots on each year

  const emptyMsg = svg
    .append("text")
    .attr("class", "empty-msg")
    .attr("x", width / 2)
    .attr("y", height / 2)
    .attr("text-anchor", "middle")
    .text("No data for this selection")
    .style("opacity", 0);

  const line = d3
    .line()
    .x((d) => x(d.year))
    .y((d) => y(d.avgPrice));

  const color = d3.scaleOrdinal(d3.schemeTableau10);
  const priceFmt = d3.format("$,.0f");

  // ---------- State shared with the tooltip ----------
  let currentSeries = [];
  let currentMeta = new Map(); // series key -> {brand, tier}
  const hiddenKeys = new Set(); // series hidden via the legend
  const brandColors = {
    Audi: "#1F77B4", // Blue
    BMW: "#AEC7E8", // Light blue
    BYD: "#FF7F0E", // Orange
    Fisker: "#FFBB78", // Light orange
    Ford: "#2CA02C", // Green
    "GM/Chevrolet": "#98DF8A", // Light green
    Honda: "#D62728", // Red
    Hyundai: "#FF9896", // Light red
    Kia: "#9467BD", // Purple
    Lucid: "#C5B0D5", // Light purple
    Mercedes: "#8C564B", // Brown
    NIO: "#C49C94", // Light brown
    Polestar: "#E377C2", // Pink
    Porsche: "#F7B6D2", // Light pink
    Rivian: "#7F7F7F", // Gray
    Tesla: "#BCBD22", // Olive
    Toyota: "#DBDB8D", // Light olive
    Volkswagen: "#17BECF", // Cyan
    Volvo: "#9EDAE5", // Light cyan
    Xiaomi: "#393B79", // Dark indigo
  };

  // Get the brand color from the series name
  function getBrandColor(seriesName) {
    const brand = seriesName.split(" · ")[0];

    return brandColors[brand] || "#888888";
  }

  // ---------- Multi-select checkbox dropdowns ----------
  function buildMultiSelect(menuId, label, values) {
    const menu = d3.select(menuId);
    const summary = menu.select("summary");

    const rows = menu
      .select(".options")
      .selectAll("label")
      .data(values)
      .join("label");

    rows
      .append("input")
      .attr("type", "checkbox")
      .attr("value", (d) => d)
      .on("change", () => {
        updateSummary();
        update();
      });
    rows.append("span").text((d) => d);

    menu
      .select(".options")
      .append("button")
      .attr("type", "button")
      .attr("class", "clear-btn")
      .text("Clear")
      .on("click", () => {
        menu.selectAll("input").property("checked", false);
        updateSummary();
        update();
      });

    function updateSummary() {
      const sel = getSelected(menuId);
      const text =
        sel.length === 0
          ? "All"
          : sel.length <= 2
            ? sel.join(", ")
            : `${sel.length} selected`;
      summary.text(`${label}: ${text}`);
    }
  }

  function getSelected(menuId) {
    return d3
      .selectAll(`${menuId} input:checked`)
      .nodes()
      .map((n) => n.value);
  }

  // Custom order for market segments, high to low
  const tierOrder = ["luxury", "premium", "mid-range", "budget"];
  const tierRank = (t) => {
    const i = tierOrder.indexOf(t.toLowerCase());
    return i === -1 ? tierOrder.length : i;
  };

  const tierValues = [...new Set(data.map((d) => d.tier))].sort(
    (a, b) => tierRank(a) - tierRank(b) || d3.ascending(a, b),
  );

  buildMultiSelect(
    "#brand-menu",
    "Brand",
    [...new Set(data.map((d) => d.brand))].sort(),
  );
  buildMultiSelect("#tier-menu", "Tier", tierValues);

  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.multi[open]").forEach((el) => {
      if (!el.contains(e.target)) el.removeAttribute("open");
    });
  });

  // ---------- Hover: guide line, tooltip, overlay ----------
  const guideLine = svg
    .append("line")
    .attr("class", "guide-line")
    .attr("y1", 0)
    .attr("y2", height)
    .style("display", "none");

  const tooltip = d3
    .select("body")
    .append("div")
    .attr("class", "chart-tooltip")
    .style("display", "none");

  function hideHover() {
    guideLine.style("display", "none");
    tooltip.style("display", "none");
    pointsLayer.selectAll("circle").attr("r", 4);
  }

  // Transparent rect on top that captures the mouse over the plot area
  svg
    .append("rect")
    .attr("class", "hover-overlay")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "none")
    .attr("pointer-events", "all")
    .on("mousemove", (event) => {
      const [mx] = d3.pointer(event);
      const year = Math.min(
        dataMax,
        Math.max(dataMin, Math.round(x.invert(mx))),
      );

      // One row per visible series that has a point in this year
      const rows = currentSeries
        .filter((s) => !hiddenKeys.has(s[0]))
        .map((s) => {
          const p = s[1].find((p) => p.year === year);
          return (
            p && { key: s[0], ...currentMeta.get(s[0]), price: p.avgPrice }
          );
        })
        .filter(Boolean)
        .sort((a, b) => b.price - a.price); // highest price first

      if (rows.length === 0) {
        hideHover();
        return;
      }

      // Vertical line + enlarge this year's points
      guideLine.style("display", null).attr("x1", x(year)).attr("x2", x(year));
      pointsLayer
        .selectAll("circle")
        .attr("r", (p) => (p.year === year ? 6 : 4));

      // Tooltip content: one table, all points for the year
      tooltip.style("display", "block").html(
        `<div class="tt-year">${year}</div>
           <table>
             <thead><tr><th></th><th>Brand</th><th>Tier</th><th>Avg price</th></tr></thead>
             <tbody>
               ${rows
                 .map(
                   (r) => `<tr>
                     <td><span class="tt-swatch" style="background:${getBrandColor(r.key)}"></span></td>
                     <td>${r.brand}</td>
                     <td>${r.tier}</td>
                     <td class="tt-price">${priceFmt(r.price)}</td>
                   </tr>`,
                 )
                 .join("")}
             </tbody>
           </table>`,
      );

      // Position next to the cursor, flipping/clamping to stay on screen
      const node = tooltip.node();
      const pad = 14;
      let left = event.clientX + pad;
      if (left + node.offsetWidth > window.innerWidth - 8) {
        left = event.clientX - node.offsetWidth - pad;
      }
      const top = Math.min(
        event.clientY + pad,
        window.innerHeight - node.offsetHeight - 8,
      );
      tooltip.style("left", `${left}px`).style("top", `${top}px`);
    })
    .on("mouseleave", hideHover);

  // ---------- Show/hide series toggled from the legend ----------
  function applyVisibility() {
    const display = (d) => (hiddenKeys.has(d[0]) ? "none" : null);
    linesLayer.selectAll("path.series").style("display", display);
    pointsLayer.selectAll("g.point-group").style("display", display);
    d3.select("#legend")
      .selectAll(".legend-item")
      .style("opacity", (d) => (hiddenKeys.has(d[0]) ? 0.35 : 1));
  }

  // ---------- Update chart ----------
  function update() {
    const brands = getSelected("#brand-menu");
    const tiers = getSelected("#tier-menu");

    const filtered = data.filter(
      (d) =>
        (brands.length === 0 || brands.includes(d.brand)) &&
        (tiers.length === 0 || tiers.includes(d.tier)),
    );

    // Brand/tier labels per series for the tooltip. When a filter isn't in
    // use, the line is an average across it, so show "All brands"/"All tiers".
    const meta = new Map();

    const keyOf = (d) => {
      const key =
        [brands.length ? d.brand : null, tiers.length ? d.tier : null]
          .filter(Boolean)
          .join(" · ") || "All EVs";
      if (!meta.has(key)) {
        meta.set(key, {
          brand: brands.length ? d.brand : "All brands",
          tier: tiers.length ? d.tier : "All tiers",
        });
      }
      return key;
    };

    const series = d3
      .rollups(
        filtered,
        (rows) =>
          Array.from(
            d3.rollup(
              rows,
              (v) => d3.mean(v, (d) => d.price),
              (d) => d.year,
            ),
            ([year, avgPrice]) => ({ year, avgPrice }),
          ).sort((a, b) => a.year - b.year),
        keyOf,
      )
      .sort((a, b) => {
        const pa = a[0].split(" · "),
          pb = b[0].split(" · ");
        if (tiers.length) {
          const brandCmp = brands.length ? d3.ascending(pa[0], pb[0]) : 0;
          return (
            brandCmp ||
            tierRank(pa[pa.length - 1]) - tierRank(pb[pb.length - 1])
          );
        }
        return d3.ascending(a[0], b[0]);
      });

    currentSeries = series;
    currentMeta = meta;
    hideHover();

    emptyMsg
      .transition()
      .duration(300)
      .style("opacity", series.length === 0 ? 1 : 0);

    // Lines
    linesLayer
      .selectAll("path.series")
      .data(series, (d) => d[0])
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("class", "series")
            .attr("fill", "none")
            .attr("stroke-width", 2)
            .attr("stroke", (d) => getBrandColor(d[0]))
            .attr("d", (d) => line(d[1]))
            .attr("opacity", 0)
            .call((e) => e.transition().duration(500).attr("opacity", 1)),
        (update) =>
          update.call((u) =>
            u
              .transition()
              .duration(500)
              .attr("d", (d) => line(d[1]))
              .attr("stroke", (d) => getBrandColor(d[0])),
          ),
        (exit) =>
          exit.call((e) =>
            e.transition().duration(300).attr("opacity", 0).remove(),
          ),
      );

    // Points: one group per series, one circle per year
    pointsLayer
      .selectAll("g.point-group")
      .data(series, (d) => d[0])
      .join(
        (enter) => enter.append("g").attr("class", "point-group"),
        (update) => update,
        (exit) =>
          exit.call((e) =>
            e.transition().duration(300).attr("opacity", 0).remove(),
          ),
      )
      .attr("fill", (d) => getBrandColor(d[0]))
      .selectAll("circle")
      .data(
        (d) => d[1],
        (p) => p.year,
      )
      .join(
        (enter) =>
          enter
            .append("circle")
            .attr("r", 4)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5)
            .attr("cx", (p) => x(p.year))
            .attr("cy", (p) => y(p.avgPrice))
            .attr("opacity", 0)
            .call((e) => e.transition().duration(500).attr("opacity", 1)),
        (update) =>
          update.call((u) =>
            u
              .transition()
              .duration(500)
              .attr("cx", (p) => x(p.year))
              .attr("cy", (p) => y(p.avgPrice)),
          ),
        (exit) => exit.remove(),
      );

    // Legend
    const items = d3
      .select("#legend")
      .selectAll(".legend-item")
      .data(series, (d) => d[0])
      .join((enter) => {
        const item = enter.append("span").attr("class", "legend-item");
        item.append("span").attr("class", "swatch");
        item.append("span").attr("class", "label");
        return item;
      });

    items.select(".swatch").style("background", (d) => getBrandColor(d[0]));
    items.select(".label").text((d) => d[0]);

    items.style("cursor", "pointer").on("click", (event, d) => {
      if (hiddenKeys.has(d[0])) hiddenKeys.delete(d[0]);
      else hiddenKeys.add(d[0]);
      applyVisibility();
    });

    applyVisibility();
  }
  /*return item;
  });

items
  .select(".swatch")
  .style("background", (d) => getBrandColor(d[0]));

items
  .select(".label")
  .text((d) => d[0]);
}*/

  update(); // initial draw
});
