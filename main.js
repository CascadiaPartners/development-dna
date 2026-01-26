// -----------------------------
// Globals
// -----------------------------
let parcelLayer = null;
let rentLayer = null;
let quantileBreaks = [];
let devTypeTable = {};
let isInitializingUI = true;
let firstZoomEnd = true;
//let baseZoom = null;
let curZoom = null;
let zoomScale = 1;

// Constants
const MIN_RADIUS = 0.5; // The smallest radius in pixel size (0.5 is still visible);
const MAX_RADIUS = 25; // The largest radius in pixel size at the reference zoom level
const DU_SCALE = 0.55; // Resizes all circles equally
const DU_EXPONENT = 0.4; // Make circle areas proportional to DU with a DU_EXPONENT of 0.5 (2 is twice the are of 1). Smaller than 0.5 makes smaller differences in circle size and the area increases more slowly as DU gets larger.
const REFERENCE_ZOOM = 14; // This should be the same as the initial zoom level in order to facilitate adjusting the circle scale factors
const PARCEL_FILL_OPACITY = 0.6; // The opacity of the circle marker
const PARCEL_LEGEND_FILL_OPACITY = 0.7; // The opacity of the circle in the legend (hard to see if too transparent)
const RENT_FILL_OPACITY = 0.4; // The opacity of the rent layer colors
const RENT_LEGEND_FILL_TRANSPARENCY = 40; // The opacity of the rent layer legend colors (hard to see if too transparent)
const MOUSE_HOVER_BORDER_WEIGHT = 2; // The border that "selects" the circle associated with the popup
const MED_LIKELIHOOD_COLOR = "#ffff00"; // Yellow
const LOW_LIKELIHOOD_COLOR = "red";
const HIGH_LIKELIHOOD_COLOR = "green";
const FEASIBILITY_CLASS_BREAKS = [0, 25, 75, 100];
const MUNICIPALITY_NAME = "Nashville";
const RENT_BREAKS = [
    { min: 2.386, max: 2.741, label: "2.386 – <$2.741", color: "red" },
    { min: 2.741, max: 2.885, label: "2.741 – <$2.885", color: "#FF7F7F" },
    { min: 2.885, max: 3.031, label: "2.885 – <$3.031", color: "#ffff00" },
    { min: 3.031, max: 3.223, label: "3.031 – <$3.223", color: "#9AD17F" },
    { min: 3.223, max: 3.782, label: "3.223 – <$3.7820", color: "green" }
];
const RENT_CLASS_FIELD = "code"; // The class code (1-5) field in the rent layer

// -----------------------------
// Map initialization
// -----------------------------
const map = L.map("map", {
    zoomControl: true
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

function formatCurrencyAllDigits(value) {
    if (value === null || value === undefined || isNaN(value)) {
        return "N/A";
    }
    return "$" + Number(value).toLocaleString("en-US", { maximumFractionDigits: 10 });
}

function formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) {
        return "N/A";
    }
    return "$" + Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCurrencyFix2(value) {
    if (value === null || value === undefined || isNaN(value)) {
        return "N/A";
    }
    return "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value, digits, units) {
    if (value === null || value === undefined || isNaN(value)) {
        return "N/A";
    }
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits }) + units;
}


// Populate the dev type dropdown
function populateDevTypeDropdown() {
    const select = document.getElementById("dev-type-select");
    select.innerHTML = "";

    const devTypes = Object.keys(devTypeTable);
    if (devTypes.length === 0) return;

    devTypes.forEach(devType => {
        const opt = document.createElement("option");
        opt.value = devType;
        opt.textContent = devType;
        select.appendChild(opt);
    });

    // Select first dev type WITHOUT triggering recompute
    select.value = devTypes[0];
}

// Load development type coefficients table
function loadDevTypeCSV() {
    fetch("DevTypeCoefficients.csv")
        .then(response => {
            if (!response.ok) {
                throw new Error("Failed to load DevTypeCoefficients.csv");
            }
            return response.text();
        })
        .then(text => {
            const lines = text.trim().split("\n");
            const headers = lines[0].split(",").map(h => h.trim());

            devTypeTable = {};

            lines.slice(1).forEach(line => {
                const values = line.split(",");
                const row = {};
                headers.forEach((h, i) => {
                    const v = values[i]?.trim();
                    row[h] = isNaN(v) ? v : Number(v);
                });

                // Use DEV_TYPE as dictionary key
                devTypeTable[row.DEV_TYPE] = row;
            });

            populateDevTypeDropdown();
        })
        .catch(err => console.error(err));
}
// Get rent class style
function getRentClassStyleByClassNumber(classNum) {
    const c = RENT_BREAKS[classNum - 1];
    return c ? c.color : "#ccc";
}

// Update the total dwelling units potential
function setTotalDU(val) {
    document.getElementById("totDUPot").innerHTML = formatNumber(val, 0, "");
}

// Set the radius of a marker
function setMarkerRadius(layer) {
    if (layer._baseRadius) {
        layer.setRadius(
            Math.max(MIN_RADIUS, layer._baseRadius * zoomScale)
        );
    }
}


// -----------------------------
// Utility: get size by value
// -----------------------------
function getMarkerSizeFromDU(du) {
    const v = Number(du);

    if (!Number.isFinite(v) || v <= 0) {
        return MIN_RADIUS;
    }

    // Make circle areas proportional to DU with a DU_EXPONENT of 0.5
    // DU_SCALE resizes everything equally so it looks good on the screen
    const r = Math.pow(v, DU_EXPONENT) * DU_SCALE;

    return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r));
}

// Get color by feasibility
function getColor(f) {
    return f >= 75 ? HIGH_LIKELIHOOD_COLOR :
        f >= 25 ? MED_LIKELIHOOD_COLOR :
            LOW_LIKELIHOOD_COLOR;
}

// -----------------------------
// Legend creation (main panel)
// -----------------------------
function buildLegend() {
    // Construction likeliehood
    const parcelDiv = document.getElementById("parcelLegend");
    parcelDiv.innerHTML = "<div id='legend-header'>Construction Likelihood</div>";
    const breaks = FEASIBILITY_CLASS_BREAKS;
    const colors = [LOW_LIKELIHOOD_COLOR, MED_LIKELIHOOD_COLOR, HIGH_LIKELIHOOD_COLOR];
    for (let i = 0; i < breaks.length - 1; i++) {
        const brkStart = breaks[i];
        const breakEnd = breaks[i + 1];
        let lessThan = "<";
        if (i == breaks.length - 2) { lessThan = ""; }

        const label = `${brkStart} – ${lessThan}${breakEnd}%`;

        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `
            <svg width="30" height="20">
                <circle cx="10" cy="10" r="7"
                        fill="${colors[i]}"
                        opacity="${PARCEL_LEGEND_FILL_OPACITY}"
                        stroke-width="1"></circle>
            </svg>
            <span>${label}</span>
        `;

        parcelDiv.appendChild(item);
    }
    parcelDiv.innerHTML = parcelDiv.innerHTML + "<div class='legend-item'></div><div class = 'legend-item'><span>Circles sized by potential dwelling units</span></div>";

    // Rent/sqft 75th Percentile
    const rendDiv = document.getElementById("rentLegend");
    rendDiv.innerHTML = "";
    RENT_BREAKS.forEach(c => {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `
            <span style="
                width:15px;
                height:15px;
                background-color:color-mix(in srgb, ${c.color}, transparent ${RENT_LEGEND_FILL_TRANSPARENCY}%);
                display:inline-block;
                margin-left:5px;
            "></span>
            <span>${c.label}</span>
        `;
        rendDiv.appendChild(item);
    });
}

// Dynamically load pako if needed for Safari browsers that don't include DecompressionStream
let pakoPromise = null;
function loadPako() {
    if (window.pako) {
        return Promise.resolve();
    }

    if (!pakoPromise) {
        pakoPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load pako"));
            document.head.appendChild(script);
        });
    }

    return pakoPromise;
}

// Dynamically load popup content
function popupContent(feature) {
    const p = feature.properties;

    return `
        <strong>Parcel Id:</strong> ${p.ParID ?? "N/A"}<br>
        <strong>Land Approx Value:</strong> ${formatCurrency(p.LandAppr)}<br>
        <strong>Improved Approx Value:</strong> ${formatCurrency(p.ImprAppr)}<br>
        <strong>Acres:</strong> ${formatNumber(p.Acres, 3, "")}<br>
        <strong>Rent/sqft (75th %):</strong> ${formatCurrencyAllDigits(p.Psf_Rent_75thpctile)}<br>
        <strong>Actual Land Value/sqft:</strong> ${formatCurrencyAllDigits(p.TOT_ValPSF)}<br>
        <strong>Dwelling Units:</strong> ${formatNumber(p.DU, 0, "")}<hr style="margin-bottom:0px">
        <div class="feasibility">Odds of Construction</div>
        <div class="feasibility" style="background-color:color-mix(in srgb, ${getColor(p.DevFeasibility)}, transparent 30%)">${formatNumber(p.DevFeasibility, 0, "% chance")}</div>
        `;
}

//function refreshOpenPopup() {
//    if (!map._popup) return;                 // No popup open

//    const layer = map._popup._source;         // The feature layer
//    if (!layer || !layer.feature) return;

//    map._popup.setContent(
//        popupContent(layer.feature)
//    );
//}

async function loadGzippedGeoJSON(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}`);
    }

    // Preferred: native streaming decompression
    if ("DecompressionStream" in window) {
        const ds = new DecompressionStream("gzip");
        const decompressedStream = response.body.pipeThrough(ds);
        const text = await new Response(decompressedStream).text();
        return JSON.parse(text);
    }

    // Fallback: pako
    await loadPako();

    const buffer = await response.arrayBuffer();
    const decompressed = pako.inflate(new Uint8Array(buffer), { to: "string" });
    return JSON.parse(decompressed);
}

loadGzippedGeoJSON("RentPSF75thPct.geojson.gz")
    //fetch("RentPSF75thPct.geojson")
    //    .then(response => {
    //        if (!response.ok) {
    //            throw new Error("Failed to load RentPSF75thPct.geojson");
    //        }
    //        return response.json();
    //    })
    .then(data => {
        // Create layer
        rentLayer = L.geoJSON(data, {
            style: feature => {
                const v = feature.properties[RENT_CLASS_FIELD];
                return {
                    fillColor: getRentClassStyleByClassNumber(v),
                    fillOpacity: RENT_FILL_OPACITY,
                    stroke: false
                };
            },
        });

    //    rentLayer.addTo(map);

        // Sync checkbox state
        const checkbox = document.getElementById("toggle-rent");
        checkbox.checked = false;
    })
    .catch(err => console.error(err));

loadGzippedGeoJSON("NashvilleTestGeoJson.geojson.gz")
    //fetch("ParcelCentroids.geojson")
    //    .then(response => {
    //        if (!response.ok) {
    //            throw new Error("Failed to load ParcelCentroids.geojson");
    //        }
    //        return response.json();
    //    })
    .then(data => {
        // Create layer
        let totDUPot = 0;
        parcelLayer = L.geoJSON(data, {
            pointToLayer: (feature, latlng) => {
                const du = feature.properties.DU;
                const baseRadius = getMarkerSizeFromDU(du);
                const feas = feature.properties.DevFeasibility;
                const color = getColor(feas);

                const marker = L.circleMarker(latlng, {
                    radius: baseRadius,
                    fillColor: color,
                    color: "black",
                    weight: MOUSE_HOVER_BORDER_WEIGHT,
                    opacity: 1,
                    fillOpacity: PARCEL_FILL_OPACITY,
                    stroke: false
                });

                marker._baseRadius = baseRadius; // store for zoom scaling
                return marker;
            },
            onEachFeature: (feature, layer) => {
                p = feature.properties;
                if (p.DevFeasibility == 100) { totDUPot += p.DU; }
                layer.bindPopup(() => popupContent(feature), {
                    autoPan: false,
                    closeButton: false
                });

                layer.on({
                    mouseover: function (e) {
                        const r = layer.getRadius();
                        const popup = layer.getPopup();

                        // Modify popup options directly
                        popup.options.offset = L.point(0, -(r - 15));

                        // Force Leaflet to recompute position
                        popup.update();

                        layer.openPopup();

                        layer.setStyle({ stroke: true });
                    },

                    mouseout: function (e) {
                        layer.closePopup();
                        layer.setStyle({ stroke: false });
                    }
                });
            }
        });

        // Add layer to map immediately
        parcelLayer.addTo(map);

        // Fit map to layer extent
        map.fitBounds(parcelLayer.getBounds(), {
            padding: [20, 20]
        });

        // Sync checkbox state
        const checkbox = document.getElementById("toggle-parcels");
        checkbox.checked = true;

        // Update max development potential
        setTotalDU(totDUPot);
    })
    .catch(err => console.error(err));

// Build legend
buildLegend();

// Recompute feasibility based on user inputs
function recomputeParcelAttributes() {
    if (isInitializingUI) return;
    if (!parcelLayer) return;

    const devType = document.getElementById("dev-type-select").value;
    if (!devType || !devTypeTable[devType]) return;

    const coeffs = devTypeTable[devType];

    const parkingRatio = Number(document.getElementById("parking_ratio").value);
    const parkingRatioSq = parkingRatio * parkingRatio;
    const parkingRatioCubed = parkingRatio * parkingRatio * parkingRatio;
    const propertyTax = Number(document.getElementById("property_tax").value / 100);
    const impactFee = Number(document.getElementById("impact_fee").value);
    let totDUPot = 0;

    parcelLayer.eachLayer(layer => {
        const p = layer.feature.properties;

        const rent75 = p.Psf_Rent_75thpctile === "" ? NaN : Number(p.Psf_Rent_75thpctile);
        const totVal = p.TOT_ValPSF === "" ? NaN : Number(p.TOT_ValPSF);
        const acres = p.Acres === "" ? NaN : Number(p.Acres);

        // Reject non-finite inputs
        if (!Number.isFinite(rent75) || !Number.isFinite(totVal) || !Number.isFinite(acres)) {
            p.DevFeasibility = null;
            p.DU = null;
            return;
        }

        const maxLandVal =
            (rent75 * coeffs.RENT_COEFF) +
            (parkingRatio * coeffs.PARKING_COEFF) +
            (parkingRatioSq * coeffs.PARKING_SQUARED_COEFF) +
            (propertyTax * coeffs.PROPTAX_COEFF) +
            (impactFee * coeffs.IMPACTFEE_CEOFF) +
            coeffs.MAX_VAL_CONSTANT;

        // Guard against divide-by-zero and non-finite results
        const devFeas =
            totVal > 0 && Number.isFinite(maxLandVal)
                ? Math.max(Math.min((maxLandVal / totVal) * 100, 100), 0)
                : null;

        DU_den =
            (parkingRatio * coeffs.DENPARK_COEFF) +
            (parkingRatioSq * coeffs.DENPARK2_COEFF) +
            (parkingRatioCubed * coeffs.DENPARK3_COEFF) +
            coeffs.DEN_CONSTANT;
        const DU = Math.round(DU_den * acres);

        p.DevFeasibility = Number.isFinite(devFeas) ? devFeas : null;
        p.DU = Number.isFinite(DU) ? DU : null;
        if (devFeas == 100) { totDUPot += DU; }

        // Update symbol sizes and colors
        const r = getMarkerSizeFromDU(DU)
        layer._baseRadius = r;
        setMarkerRadius(layer);
        layer.setStyle({
            fillColor: getColor(devFeas)
        });

        // Update max development potential
        setTimeout(() => {
            setTotalDU(totDUPot);
        }, 0);
    });

    //refreshOpenPopup();
}

// Set municipality name
document.getElementById("municipality_name").innerHTML = MUNICIPALITY_NAME;
// -----------------------------
// Layer toggle (main panel)
// -----------------------------
document
    .getElementById("toggle-parcels")
    .addEventListener("change", e => {
        if (!parcelLayer) return;
        const parcelLegend = document.getElementById("parcelLegend");
        if (e.target.checked) {
            parcelLayer.addTo(map);
            parcelLegend.style.display = "block";
        } else {
            map.removeLayer(parcelLayer);
            parcelLegend.style.display = "none";
        }
    });
document.getElementById("toggle-rent")
    .addEventListener("change", e => {
        if (!rentLayer) return;
        const rentLegend = document.getElementById("rentLegend");
        if (e.target.checked) {
            rentLayer.addTo(map);
            parcelLayer.bringToFront();
            rentLegend.style.display = "block";
        } else {
            map.removeLayer(rentLayer);
            rentLegend.style.display = "none";
        }
    });

// Get panel elements
const panel = document.getElementById('map-panel');
const collapseBtn = document.getElementById('panel-collapse');
const expandBtn = document.getElementById('panel-expand');

// Collapse panel
collapseBtn.addEventListener('click', () => {
    panel.classList.add('collapsed');

    // Redraw map after CSS transition
    setTimeout(() => {
        map.invalidateSize();
    }, 300);
});

// Expand panel
expandBtn.addEventListener('click', () => {
    panel.classList.remove('collapsed');

    setTimeout(() => {
        map.invalidateSize();
    }, 300);
});

// Load Development type coefficients table
loadDevTypeCSV();

let recomputeTimer = null;
function scheduleRecompute() {
    clearTimeout(recomputeTimer);
    //recomputeTimer = setTimeout(recomputeParcelAttributes, 200);

    recomputeTimer = setTimeout(() => {
        const infoDiv = document.getElementById("info");
        infoDiv.textContent = "Calculating feasibility...";
        // Yield to the browser so it can actually PAINT the text
        // Using a 0ms timeout pushes the heavy work to the end of the current queue
        setTimeout(() => { recomputeParcelAttributes(); infoDiv.textContent = ""; }, 10);
    }, 150);
}

// Bind dropdown to function to recompute parcel attributes
document
    .getElementById("dev-type-select")
    .addEventListener("change", scheduleRecompute);


// Bind sliders to the displayed values
function bindSlider(id, units) {
    const slider = document.getElementById(id);
    const valueSpan = document.getElementById(`${id}_value`);

    valueSpan.textContent = formatNumber(slider.value, 3, "") + units;

    slider.addEventListener("input", () => {
        valueSpan.textContent = formatNumber(slider.value, 3, "") + units;
    });
    slider.addEventListener("change", () => {
        scheduleRecompute();
    });
}
bindSlider("parking_ratio", "");
bindSlider("property_tax", "%");
bindSlider("impact_fee", "$");

// Update symbol sizes on zoom
const BASE_ZOOM = map.getZoom();
map.on("zoomend", () => {
    //if (firstZoomEnd) {
    //    firstZoomEnd = false;
    //    baseZoom = map.getZoom();
    //    console.log(baseZoom);
    //    return;
    //}
    curZoom = map.getZoom();
    zoomScale = Math.pow(2, curZoom - REFERENCE_ZOOM);

    parcelLayer.eachLayer(layer => {
        setMarkerRadius(layer);
    });
});

// Reset init UI flag
isInitializingUI = false;


