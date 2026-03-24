// -----------------------------
// Globals
// -----------------------------
let parcelLayer = null;
let parcelGeoJSONData = null;
let activeFilterField = null;
let rentLayer = null;
let quantileBreaks = [];
let devTypeTable = {};
let firstZoomEnd = true;
let curZoom = null;
let zoomScale = 1;
let currentTotDUPot = 0;
let settings = null;
let sliderIds = [];
let maxValandDensityFunction = null;
let recomputeTimer = null;
let pakoPromise = null;
let sql_wasm_js_promise = null;
const panel = document.getElementById('map-panel');
const collapseBtn = document.getElementById('panel-collapse');
const expandBtn = document.getElementById('panel-expand');
let feasibility_threshold = 100;

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
async function loadDevTypeCSV() {
    const response = await fetch("DevTypeCoefficients.csv");
    if (!response.ok) {
        throw new Error("Failed to load DevTypeCoefficients.csv");
    }
    const text = await response.text();
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

        devTypeTable[row.DEV_TYPE] = row;
    });

    populateDevTypeDropdown();
}

// Load sliders from CSV
async function loadSlidersFromCSV() {
    const response = await fetch("sliders.csv");
    if (!response.ok) {
        throw new Error("Failed to load sliders.csv");
    }
    const text = await response.text();
    const rows = parseCSV(text);
    const section = document.querySelector("#panel-content section");
    rows.forEach(row => {
        const sliderBlock = createSliderBlock(row);
        section.appendChild(sliderBlock);
        sliderIds.push(row.formula_name);
    });
}

// Load settings file from json
async function loadSettings() {
    const response = await fetch('Nashville/settings.json');
    if (!response.ok) throw new Error('Could not load settings.');
    settings = await response.json();
}

// Parse csv file
function parseCSV(text) {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",");

    return lines.slice(1).map(line => {
        const values = line.split(",");
        const obj = {};
        headers.forEach((h, i) => {
            obj[h.trim()] = values[i]?.trim();
        });
        return obj;
    });
}

//Slider Creator
function createSliderBlock(config) {

    const {
        id,
        title,
        init_val,
        formula_name,
        min,
        max,
        step,
        unit_symbol
    } = config;

    const block = document.createElement("div");
    block.className = "slider-block";

    const header = document.createElement("div");
    header.className = "slider-header";

    const label = document.createElement("label");
    label.setAttribute("for", formula_name);
    label.textContent = title;

    const valueSpan = document.createElement("span");
    valueSpan.className = "slider-value";
    valueSpan.id = `${formula_name}_value`;

    header.appendChild(label);
    header.appendChild(valueSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.id = formula_name;
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = init_val;

    block.appendChild(header);
    block.appendChild(input);

    // Formatting Logic
    function formatValue(val) {
        const num = Number(val);

        if (unit_symbol === "$") {
            return num.toLocaleString() + "$";
        }

        if (unit_symbol === "%") {
            return num + "%";
        }

        return num;
    }

    // Initialize display
    valueSpan.textContent = formatValue(init_val);

    // Live update
    input.addEventListener("input", () => {
        valueSpan.textContent = formatValue(input.value);
    });
    input.addEventListener("change", () => {
        scheduleRecompute();
    });

    return block;
}

// Create max value and density equation function
function createMaxValandDensityFunction() {
    // Lowercase the equation and swap ^ for **
    let maxValEquation = settings["Max Value Equation"].toLowerCase().replace(/\^/g, '**');
    let densityEquation = settings["Density Equation"].toLowerCase().replace(/\^/g, '**');

    // Validate to prevent injection
    if (!/^[0-9a-zA-Z_+\-*/().\s^]+$/.test(maxValEquation)) {
        throw new Error("Invalid characters in Max Value equation.");
    }
    if (!/^[0-9a-zA-Z_+\-*/().\s^]+$/.test(densityEquation)) {
        throw new Error("Invalid characters in Density equation.");
    }

    // Create array of parameters from csv, sliders, and layer attributes
    const params = [];

    // Add CSV data skipping the deve type column
    const outerKey = Object.keys(devTypeTable)[0];
    const innerKeys = Object.keys(devTypeTable[outerKey]);
    for (let n = 1; n < innerKeys.length; n++) {
        params.push(innerKeys[n].toLowerCase());
    }

    // Add Local Code variables (overwrites CSV if names collide)
    for (const id of sliderIds) {
        params.push(id.toLowerCase());
    }

    // Add rent_psf attribute from parcel layer
    params.push("rent_psf");

    // Check for missing variables
    // This regex finds words that aren't math operators/numbers
    let variablesInEquation = maxValEquation.match(/[a-z_][a-z0-9_]*/g) || [];
    let missing = variablesInEquation.filter(v => !params.includes(v));
    if (missing.length > 0) {
        throw new Error(`Unknown variables in equation: ${missing.join(', ')}`);
    }
    variablesInEquation = densityEquation.match(/[a-z_][a-z0-9_]*/g) || [];
    missing = variablesInEquation.filter(v => !params.includes(v));
    if (missing.length > 0) {
        throw new Error(`Unknown variables in equation: ${missing.join(', ')}`);
    }

    // Create the function
    // const {maxTotalVal, DU_den} = calcMaxValandDensity(...vals);
    calcMaxValandDensity = new Function(...params, `
    let maxTotalVal;
    let DU_den;
    try {
        maxTotalVal = ${maxValEquation};
        DU_den = ${densityEquation};
    } catch (err) {
        console.error("Error:", err);
    }
    return [maxTotalVal, DU_den]; 
    `);
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
        <strong>Rent/sqft (75th %):</strong> ${formatCurrencyAllDigits(p.rent_psf)}<br>
        <strong>Actual Total Value/sqft:</strong> ${formatCurrencyAllDigits(p.total_val_psf)}<br>
        <strong>Dwelling Units:</strong> ${formatNumber(p.DU, 0, "")}<hr style="margin-bottom:0px">
        <div class="feasibility">Odds of Construction</div>
        <div class="feasibility" style="background-color:color-mix(in srgb, ${getColor(p.DevFeasibility)}, transparent 30%)">${formatNumber(p.DevFeasibility, 0, "% chance")}</div>
        `;
}

// Initialize parcel filters
function initializeParcelFilters() {
    const fieldSelect = document.getElementById("parcel-field-select");

    if (!parcelGeoJSONData.features.length) return;

    const sampleProps = parcelGeoJSONData.features[0].properties;

    Object.keys(sampleProps).forEach(field => {
        if (typeof sampleProps[field] === "string") {
            const option = document.createElement("option");
            option.value = field;
            option.textContent = field;
            fieldSelect.appendChild(option);
        }
    });
}

// PointToLayer function for parcels
function parcelPointToLayer(feature, latlng) {

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

    marker._baseRadius = baseRadius;

    return marker;
}

// OnEachFeature function for parcels
function parcelOnEachFeature(feature, layer) {
    layer.bindPopup(() => popupContent(feature), {
        autoPan: false,
        closeButton: false
    });

    layer._visible = true;

    layer.on({
        mouseover: function () {
            if (layer.options.fillOpacity === 0) return;
            const r = layer.getRadius();
            const popup = layer.getPopup();

            popup.options.offset = L.point(0, -(r - 15));
            popup.update();

            layer.openPopup();
            layer.setStyle({ stroke: true });
        },

        mouseout: function () {
            layer.closePopup();
            layer.setStyle({ stroke: false });
        }
    });
}

// Apply parcel filter
function applyParcelFilter(selectedValue) {

    currentTotDUPot = 0;

    parcelLayer.eachLayer(layer => {

        const p = layer.feature.properties;
        const visible = !selectedValue || p[activeFilterField] === selectedValue;

        // Update visual style only
        layer.setStyle({
            opacity: visible ? 1 : 0,
            fillOpacity: visible ? PARCEL_FILL_OPACITY : 0
        });

        // Toggle interactivity properly
        layer.options.interactive = visible;

        // Count DU for visible only
        if (visible) {
            if (Number.isFinite(p.DevFeasibility) && p.DevFeasibility >= feasibility_threshold) {
                currentTotDUPot += p.DU;
            }
        }

        // Update visible attribute used during recompute
        layer._visible = visible;

        //if (!visible) {
        //    layer.closePopup();
        //}

    });

    // Update DU in panel
    setTotalDU(currentTotDUPot);
}

// Apply the changed likelihood threshold
function applyChangedLikelihoodThreshold() {
    currentTotDUPot = 0;

    parcelLayer.eachLayer(layer => {
        // Count DU for visible only
        if (layer._visible) {
            const p = layer.feature.properties;
            if (Number.isFinite(p.DevFeasibility) && p.DevFeasibility >= feasibility_threshold) {
                currentTotDUPot += p.DU;
            }
        }
    });

    // Update DU in panel
    setTotalDU(currentTotDUPot);
}

// Recompute feasibility based on user inputs
function recomputeParcelAttributes() {
    if (!parcelLayer) return;

    const devType = document.getElementById("dev-type-select").value;
    if (!devType || !devTypeTable[devType]) return;

    const coeffs = devTypeTable[devType];

    const parkingRatio = Number(document.getElementById("parking_ratio").value);
    const parkingRatioSq = parkingRatio * parkingRatio;
    const parkingRatioCubed = parkingRatio * parkingRatio * parkingRatio;
    const propertyTax = Number(document.getElementById("property_tax").value / 100);
    const impactFee = Number(document.getElementById("impact_fee").value);

    // Build list of values to supply to equation function
    // Dev Type table values.  Skip the first which is the dev type.
    vals = [];
    const coeffVals = Object.values(coeffs);
    for (let n = 1; n < coeffVals.length; n++) {
        vals.push(coeffVals[n])
    }
    // Slider values
    for (const id of sliderIds) {
        let val = Number(document.getElementById(id).value);
        if (id == "property_tax") { val = val / 100; }
        vals.push(val);
    }
    // Add item for replaceable rent value
    vals.push(0);

    // Get last index for ease of rent insertion
    const rentIndex = vals.length - 1;

    // Initialize the total DU
    currentTotDUPot = 0;

    // Loop through the features
    parcelLayer.eachLayer(layer => {
        // Get feature attributes needed for calcs
        const p = layer.feature.properties;
        const rent_psf = p.rent_psf === "" ? NaN : Number(p.rent_psf);
        const total_val_psf = p.total_val_psf === "" ? NaN : Number(p.total_val_psf);
        const acres = p.Acres === "" ? NaN : Number(p.Acres);

        // Reject non-finite inputs
        if (!Number.isFinite(rent_psf) || !Number.isFinite(total_val_psf) || !Number.isFinite(acres)) {
            p.DevFeasibility = null;
            p.DU = null;
            return;
        }

        // Replace the rent for this feature
        vals[rentIndex] = rent_psf;

        // Call the dynamically generated function to calc regression equations
        const [maxTotalVal, DU_den] = calcMaxValandDensity(...vals);

        //const maxTotalVal =
        //    (rent_psf * coeffs.RENT_COEFF) +
        //    (parkingRatio * coeffs.PARKING_COEFF) +
        //    (parkingRatioSq * coeffs.PARKING_SQUARED_COEFF) +
        //    (propertyTax * coeffs.PROPTAX_COEFF) +
        //    (impactFee * coeffs.IMPACTFEE_COEFF) +
        //    coeffs.MAX_VAL_CONSTANT;

        // Guard against divide-by-zero and non-finite results
        const devFeas =
            total_val_psf > 0 && Number.isFinite(maxTotalVal)
                ? Math.max(Math.min((maxTotalVal / total_val_psf) * 100, 100), 0)
                : null;

        //DU_den =
        //    (parkingRatio * coeffs.DENPARK_COEFF) +
        //    (parkingRatioSq * coeffs.DENPARK2_COEFF) +
        //    (parkingRatioCubed * coeffs.DENPARK3_COEFF) +
        //    coeffs.DEN_CONSTANT;

        // Multiple density by acres to get dwelling units
        const DU = Math.round(DU_den * acres);

        // Set feature properties
        p.DevFeasibility = Number.isFinite(devFeas) ? devFeas : null;
        p.DU = Number.isFinite(DU) ? DU : null;

        // Add to total DU count if selected in filter
        if (Number.isFinite(devFeas) && devFeas >= feasibility_threshold && layer._visible) { currentTotDUPot += DU; }

        // Update symbol sizes and colors
        const r = getMarkerSizeFromDU(DU)
        layer._baseRadius = r;
        setMarkerRadius(layer);
        layer.setStyle({
            fillColor: getColor(devFeas)
        });

    });

    // Update max development potential
    setTimeout(() => {
        setTotalDU(currentTotDUPot);
    }, 0);
}

// Create geopackage required tables
function initializeArcGISCompatibleGPKG(db) {
    db.exec(`
            PRAGMA application_id = 1196437808;  -- "GPKG"
            PRAGMA user_version = 10200;

            CREATE TABLE gpkg_spatial_ref_sys (
                srs_name TEXT NOT NULL,
                srs_id INTEGER NOT NULL PRIMARY KEY,
                organization TEXT NOT NULL,
                organization_coordsys_id INTEGER NOT NULL,
                definition TEXT NOT NULL DEFAULT 'undefined',
                description TEXT,
                definition_12_063 TEXT NOT NULL DEFAULT 'undefined'
            );

            INSERT INTO gpkg_spatial_ref_sys VALUES
            ('Undefined Cartesian', -1, 'NONE', -1, 'undefined', NULL, 'undefined');

            INSERT INTO gpkg_spatial_ref_sys VALUES
            ('Undefined Geographic', 0, 'NONE', 0, 'undefined', NULL, 'undefined');

            INSERT INTO gpkg_spatial_ref_sys VALUES
            (
            'WGS 84 geodetic',
            4326,
            'EPSG',
            4326,
            'GEOGCS["WGS 84",DATUM["WGS_1984"]]',
            'WGS 84',
            'GEOGCRS["WGS 84",DATUM["World Geodetic System 1984",
                ELLIPSOID["WGS 84",6378137,298.257223563]],
                CS[ellipsoidal,2],
                AXIS["Latitude",north],
                AXIS["Longitude",east],
                ANGLEUNIT["degree",0.0174532925199433],
                ID["EPSG",4326]]'
            );

            CREATE TABLE gpkg_contents (
                table_name TEXT NOT NULL PRIMARY KEY,
                data_type TEXT NOT NULL,
                identifier TEXT UNIQUE,
                description TEXT DEFAULT '',
                last_change DATETIME NOT NULL DEFAULT
                    (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                min_x DOUBLE,
                min_y DOUBLE,
                max_x DOUBLE,
                max_y DOUBLE,
                srs_id INTEGER,
                FOREIGN KEY (srs_id)
                REFERENCES gpkg_spatial_ref_sys(srs_id)
            );

            CREATE TABLE gpkg_geometry_columns (
                table_name TEXT NOT NULL,
                column_name TEXT NOT NULL,
                geometry_type_name TEXT NOT NULL,
                srs_id INTEGER NOT NULL,
                z TINYINT NOT NULL,
                m TINYINT NOT NULL,
                PRIMARY KEY (table_name, column_name),
                FOREIGN KEY (srs_id)
                REFERENCES gpkg_spatial_ref_sys(srs_id),
                FOREIGN KEY (table_name)
                REFERENCES gpkg_contents(table_name)
            );

            CREATE TABLE gpkg_extensions (
                table_name TEXT,
                column_name TEXT,
                extension_name TEXT NOT NULL,
                definition TEXT NOT NULL,
                scope TEXT NOT NULL,
                UNIQUE (table_name, column_name, extension_name)
            );

            INSERT INTO gpkg_extensions VALUES
            (
            'gpkg_spatial_ref_sys',
            'definition_12_063',
            'gpkg_crs_wkt',
            'http://www.geopackage.org/spec121/#extension_crs_wkt',
            'read-write'
            );
    `);
}

// Dynamically load sql_wasm_js as needed
function sql_wasm_js() {
    if (!sql_wasm_js_promise) {
        sql_wasm_js_promise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load sql_wasm_js"));
            document.head.appendChild(script);
        });
    }

    return sql_wasm_js_promise;
}

// Create a point compatible with ArcGIS
function createArcGISPoint(lon, lat) {
    const buffer = new ArrayBuffer(8 + 1 + 4 + 8 + 8 + 8);
    const view = new DataView(buffer);
    let offset = 0;

    // GP header
    view.setUint8(offset++, 0x47);
    view.setUint8(offset++, 0x50);
    view.setUint8(offset++, 0);
    view.setUint8(offset++, 1);
    view.setUint32(offset, 4326, true);
    offset += 4;

    // WKB
    view.setUint8(offset++, 1);
    view.setUint32(offset, 1001, true); // POINT Z
    offset += 4;

    view.setFloat64(offset, lon, true); offset += 8;
    view.setFloat64(offset, lat, true); offset += 8;
    view.setFloat64(offset, 0, true); offset += 8;

    return new Uint8Array(buffer);
}

// Exports the filtered parcel layer to GeoPackage
async function exportParcelLayerToGeoPackage() {
    // Collect only the visible features
    const visibleFeatures = [];
    parcelLayer.eachLayer(l => {
        if (l._visible) {
            // Ensure it has properties
            const feature = l.toGeoJSON();
            feature.properties = feature.properties || {};
            visibleFeatures.push(feature);
        }
    });
    if (!visibleFeatures.length) {
        alert("No visible features to export.");
        return;
    }

    // Extract attribute field names
    const attributeFields = Object.keys(visibleFeatures[0].properties);

    // Create a FeatureCollection
    const featureCollection = {
        type: "FeatureCollection",
        features: visibleFeatures
    };

    // 2️⃣ gpkg_contents
    // compute extent
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    featureCollection.features.forEach(f => {
        const [x, y] = f.geometry.coordinates;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    });

    // Create GeoPackage or geojson if error
    let type = "GeoPackage";
    let filename = "parcel_centroids.gpkg";
    let blob = null;
    try {

        await sql_wasm_js();
        const wasmURL = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm";
        await fetch(wasmURL).then(r => {
            if (!r.ok) throw new Error("WASM not available");
        });
        const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
        const db = new SQL.Database();

        // 1️⃣ Standard GeoPackage tables
        initializeArcGISCompatibleGPKG(db);

        // Build attribute columns (INTEGER for numbers, TEXT otherwise)
        const attributeColumns = attributeFields.map(field => {
            const value = visibleFeatures[0].properties[field];
            const type = Number.isInteger(value) ? "INTEGER" :
                typeof value === "number" ? "REAL" :
                    "TEXT";
            return `${field} ${type}`;
        }).join(",\n    ");

        // Create the table
        const createTableSQL = `
            CREATE TABLE parcel_centroids (
                OBJECTID INTEGER PRIMARY KEY AUTOINCREMENT,
                Shape POINT NOT NULL,
                ${attributeColumns}
            );`;

        db.run(createTableSQL);

        // insert gpkg_contents with real extent
        db.run(`
            INSERT INTO gpkg_contents
            (table_name,data_type,identifier,description,last_change,min_x,min_y,max_x,max_y,srs_id)
            VALUES
            ('parcel_centroids','features','parcel_centroids','Parceel centroid points',strftime('%Y-%m-%dT%H:%M:%fZ','now'),${minX},${minY},${maxX},${maxY},4326)
          `);
        // 3️⃣ gpkg_geometry_columns
        db.run(`
            INSERT INTO gpkg_geometry_columns
            (table_name,column_name,geometry_type_name,srs_id,z,m)
            VALUES
            ('parcel_centroids','Shape','POINT',4326,1,0)
          `);

        // 5️⃣ Insert features
        const placeholders = attributeFields.map(() => "?").join(", ");
        const insertSQL = `
            INSERT INTO parcel_centroids (Shape, ${attributeFields.join(", ")})
            VALUES (?, ${placeholders})
        `;
        const stmt = db.prepare(insertSQL);
        visibleFeatures.forEach(f => {
            const values = attributeFields.map(field => f.properties[field]);
            stmt.run([
                createArcGISPoint(
                    f.geometry.coordinates[0],
                    f.geometry.coordinates[1]
                ),
                ...values
            ]);
        });
        stmt.free();

        // 6️⃣ Export GeoPackage
        const arrayBuffer = db.export();
        blob = new Blob([arrayBuffer], { type: "application/geopackage+sqlite3" });
    }
    catch (err) {
        type = "GeoJSON";
        filename = "parcel_centroids.geojson";

        // Convert to GeoJSON blob
        blob = new Blob([JSON.stringify(featureCollection)], {
            type: "application/json"
        });
    }

    // Trigger download
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

// Function to load a gzipped geojson
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

// Load rent layer
async function loadRentLayer() {
    try {
        // Load the geojson
        const data = await loadGzippedGeoJSON("RentPSF75thPct.geojson.gz");

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

        // rentLayer.addTo(map);

        // Sync checkbox state
        const checkbox = document.getElementById("toggle-rent");
        checkbox.checked = false;
    } catch (err) {
        console.error("Error loading rent layer:", err);
    }
}

// Load parcel layer
async function loadParcelLayer() {
    try {
        // Load gzipped geojson
        const data = await loadGzippedGeoJSON("NashvilleParcels20260324.geojson.gz");

        // Create layer
        parcelLayer = L.geoJSON(data, {
            pointToLayer: parcelPointToLayer,
            onEachFeature: parcelOnEachFeature
        });

        // Save all features data for parcel filters
        parcelGeoJSONData = data;
    } catch (err) {
        console.error("Error loading parcel layer: ", err);
    }
}

// Load parcel layer
function InitParcelLayer() {
    try {
        // Initial calculation of feasibility and DU
        recomputeParcelAttributes();

        // Add layer to map immediately
        parcelLayer.addTo(map);

        // Fit map to layer extent
        map.fitBounds(parcelLayer.getBounds(), {
            padding: [20, 20]
        });

        // Sync checkbox state
        const checkbox = document.getElementById("toggle-parcels");
        checkbox.checked = true;

        // Initialize parcel filters
        initializeParcelFilters();
    } catch (err) {
        console.error("Error initializing parcel layer: ", err);
    }
}

// Schedule a recompute of parcel attributes
function scheduleRecompute() {
    clearTimeout(recomputeTimer);

    recomputeTimer = setTimeout(() => {
        const infoDiv = document.getElementById("info");
        infoDiv.textContent = "Calculating feasibility...";
        infoDiv.style.visibility = "visible";
        // Yield to the browser so it can actually PAINT the text
        // Using a 0ms timeout pushes the heavy work to the end of the current queue
        setTimeout(() => { recomputeParcelAttributes(); infoDiv.style.visibility = "hidden"; }, 10);
    }, 150);
}

// Load data that is required first
async function loadData() {
    // Load data that is required first
    await Promise.all([
        // Load Development type coefficients table
        loadDevTypeCSV(),

        // Load sliders
        loadSlidersFromCSV(),

        // Load settings
        loadSettings(),

        // Load parcel layer (not initialized or made visible here)
        loadParcelLayer()
    ]);
    // Create the function for the max value and density equations from csv, slider, and settings data
    createMaxValandDensityFunction();

    // Initialize the parcel layer (calc feasibility and DU, make visible)
    InitParcelLayer();

    // Set municipality name
    document.getElementById("municipality_name").innerHTML = settings["Municipality Name"];
}

// Map initialization
const map = L.map("map", {
    zoomControl: true
});

// Timing
//console.time("Test");
//// This fires only when all visible tiles/layers have finished loading
//map.on('load', () => {
//    console.timeEnd("Test");
//    console.log("Map is visually fully loaded.");
//});

// Create base layer
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

// Load rent layer when the map is ready (lazy background loading)
map.whenReady(() => {
    loadRentLayer();
});

// Load data in the order that it is required for subsequent code
loadData();

// Build legend
buildLegend();

// Layer toggle (main panel)
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

// Bind dropdown to function to recompute parcel attributes
document
    .getElementById("dev-type-select")
    .addEventListener("change", scheduleRecompute);

// Update symbol sizes on zoom
map.on("zoomend", () => {
    curZoom = map.getZoom();
    zoomScale = Math.pow(2, curZoom - REFERENCE_ZOOM);

    parcelLayer.eachLayer(layer => {
        setMarkerRadius(layer);
    });
});

// When filter field changes build unique values
document.getElementById("parcel-field-select")
    .addEventListener("change", e => {

        activeFilterField = e.target.value;
        const valueSelect = document.getElementById("parcel-value-select");

        valueSelect.innerHTML = '<option value="">Select value…</option>';
        valueSelect.disabled = !activeFilterField;

        if (!activeFilterField) {
            applyParcelFilter("");
            valueSelect.options.length = 0;
            return;
        }

        const uniqueValues = new Set();

        parcelGeoJSONData.features.forEach(f => {
            const v = f.properties[activeFilterField].trim();
            if (v !== null && v !== undefined && v !== "") {
                uniqueValues.add(v);
            }
        });

        Array.from(uniqueValues)
            .sort()
            .forEach(val => {
                const option = document.createElement("option");
                option.value = val;
                option.textContent = val;
                valueSelect.appendChild(option);
            });
    });

// When filter values changes, apply parcel filter
document.getElementById("parcel-value-select")
    .addEventListener("change", e => {
        activeFilterValue = e.target.value;
        applyParcelFilter(activeFilterValue);
    });

// When construction likelihood threshold changes recompute attributes
threshold_input = document.getElementById("likelihood_threshold");
threshold_valueSpan = document.getElementById("likelihood_threshold_value");
threshold_input.addEventListener("input", () => {
    feasibility_threshold = Number(threshold_input.value);
    threshold_valueSpan.textContent = feasibility_threshold.toLocaleString() + "%";
});
threshold_input.addEventListener("change", () => {
    applyChangedLikelihoodThreshold();
});

document.getElementById('export-geojson').addEventListener('click', async (e) => {
    const el = e.target;
    if (el.classList.contains('loading')) return;

    el.innerText = "Loading...";
    el.classList.add('loading');
    // Force a paint cycle to ensure "Loading..." appears
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
        await exportParcelLayerToGeoPackage();
        el.innerText = "Done!";
    } catch (err) {
        console.error("Export failed:", err);
        alert(err?.message || err);
    } finally {
        el.classList.remove('loading');
        setTimeout(() => el.innerText = "Export", 3000);
    }
});

