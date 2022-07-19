"use strict";

// Number of photos to display at a time
// This will also be the number of observations retrieved at one time
const PHOTODISPLAYNUM = 20;

// Milliseconds to wait after user stops typing to display autocomplete results. Necessarry to ensure we don't spam the api
const AUTOCOMPLETEWAIT = 500;

let children = {};
let parentTaxon;
let childIds = [];
let curChildNum;
let nextChildPromise;
let inputWaitTimer;
let autocompleteLoaded = false;

const parentInput = document.querySelector("#iNatTaxonID");
const iNatPhotosDiv = document.querySelector('#inat-photos');
const prevChildButton = document.querySelector('#prev-child');
const nextChildButton = document.querySelector('#next-child');
const prevPhotosButton = document.querySelector('#prev-photos');
const nextPhotosButton = document.querySelector('#next-photos');
const autocompleteResultsDiv = document.querySelector('#autocomplete-results');

async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) // check if response worked (no 404 errors etc...)
        throw new Error(response.statusText);

    const data = response.json(); // get JSON from the response
    return data; // returns a promise, which resolves to this data value
}

class Photo {
    constructor(observationData, photoNum) {
        this.id = observationData.photos[photoNum].id;
        this.license = observationData.photos[photoNum].license_code;
        this.url = observationData.photos[photoNum].url;
        this.attribution = observationData.photos[photoNum].attribution;
        this.observationId = observationData.id;
        this.qualityGrade = observationData.quality_grade;
    }

    // does photo have a commons-compatible license?
    isLicensed() {
        switch (this.license) {
            case "cc0": 
            case "cc-by": 
            case "cc-by-sa":
                return true;
        }
        return false;
    }

    returnDiv() {
        let image = document.createElement('img');
        image.src = this.url;
        let borderColour;
        switch (this.qualityGrade) {
            case "research": 
                borderColour = "green";
                break;
            case "needs_id":
                borderColour = "yellow";
                break;
            case "casual":
                borderColour = "red";
                break;
        }
        image.style = "border:4px solid " + borderColour + ";";

        let link = document.createElement('a');
        link.target = "_blank";
        link.href = "https://www.inaturalist.org/observations/" + this.observationId;     
        link.style = "margin:4px;"

        link.appendChild(image);       

        return link;
    }

}

class Taxon {
    constructor(taxonData) {
        this.id = taxonData.id;
        this.latinName = taxonData.name;
        this.rank = taxonData.rank;
        this.children = taxonData.children;
        this.hasChildren = (this.children != undefined);
        if (this.hasChildren) this.childrenNum = this.children.length;
        this.commonName = taxonData.preferred_common_name;
        this.hasCommonName = (this.commonName != undefined);
        this.observations = [];
        this.photos = [];
        this.photoPos = 0;
        this.curMaxId = -1;
        if (this.hasCommonName) this.name = this.commonName;
        else this.name = this.latinName;
        this.loaded = false;
    }

    formattedName() {
        let latinName = this.latinName;
        if (this.rank == "species" || this.rank == "genus" || this.rank == "subspecies") {
            latinName = "<i>" + latinName + "</i>";
        }
        if (this.hasCommonName) {
            return this.commonName + " (" + latinName + ") ";
        }
        return latinName + " " + this.id;
    }

    addObservations(observationData) {        
        
        // this is NOT the same as the length of this.observations, as that only returns the number of observations in the current json request
        if (this.photos.length == 0) {
            this.observationCount = observationData.total_results;
        }        
        // there is no way to get the numbers of licensed *photos* without making an arbitrarily large number of api requests

        if (this.observationCount == 0) return;
        for (let observation of observationData.results) {
            let newObs = {};
            newObs.qualityGrade = observation.quality_grade;
            newObs.datetime = observation.time_observed_at;
            newObs.id = observation.id;
            newObs.geoprivacy = observation.geoprivacy;
            if (newObs.geoprivacy = null) newObs.geoprivacy = "open";            
            for (let i = 0; i < observation.photos.length; i++) {
                let curPhoto = new Photo(observation, i);
                if (curPhoto.isLicensed) this.photos.push(curPhoto);
            }
            newObs.location = observation.location;

            this.observations.push(newObs);
        };

        this.curMaxId = this.observations[this.observations.length - 1].id;
    }

    async getLicensedPhotos () {
        let maxIdStr = "";
        if (this.curMaxId != -1) {
            maxIdStr = "&id_below=" + this.curMaxId;
        }
        let perPageStr = "&per_page=" + PHOTODISPLAYNUM;
        const data = await getJSON("https://api.inaturalist.org/v1/observations?photo_license=cc-by%2Ccc-by-sa%2Ccc0&taxon_id=" + this.id + maxIdStr + perPageStr)
        return data;
    }

    async getWikidataId () {
        const sparqlQuery = `SELECT ?item
WHERE
{
?item wdt:P3151 "` + this.id + `".
}`;
        const data = await getJSON('https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparqlQuery) + '&format=json');
        this.wikidataID = data?.results?.bindings[0]?.item?.value;
    }
    
    async loadPhotos () {
        this.addObservations(await this.getLicensedPhotos());
        if (this.observationCount == this.observations.length) {
            this.loaded = true;
        }
    }

    async preloadPhotos () {
        if (this.loaded) {
            return;
        }
        if (this.photos.length - this.photoPos < PHOTODISPLAYNUM * 2) {
            this.addObservations(await this.getLicensedPhotos());
        }
    }

    makePhotos () {
        let photosDiv = document.createElement('div');
        for (let i = this.photoPos; i < this.photoPos + PHOTODISPLAYNUM; i++) {
            if (i == this.photos.length) break;
            photosDiv.appendChild(this.photos[i].returnDiv());
        }
        return photosDiv;
    }

    nextPhotos () {
        nextPhotosButton.disabled = true;
        this.photoPos += PHOTODISPLAYNUM;
        prevPhotosButton.disabled = false;      
        return this.makePhotos();
    }

    prevPhotos () {
        prevPhotosButton.disabled = true;
        this.photoPos -= PHOTODISPLAYNUM;
        nextPhotosButton.disabled = false;
        if (this.photoPos > 0) {
            prevPhotosButton.disabled = false;
        }
        return this.makePhotos();
    }

    onLastPage () {
        if (this.photos.length - this.photoPos <= PHOTODISPLAYNUM) {
            return true;
        }
        return false;
    }

}

async function loadNextChild(override = false) {
    if ((curChildNum != parentTaxon.children.length - 1 && curChildNum == childIds.length - 1) || override) {
        let curChild = new Taxon(parentTaxon.children[curChildNum + 1]);
        childIds.push(curChild.id);
        children[childIds[curChildNum + 1]] = curChild;
        await curChild.loadPhotos()
    }
    // Still throwing erros when a child taxon has no photos TODO
    return true;
}

async function displayChild() {
    
    nextChildPromise = loadNextChild();

    let curChild = children[childIds[curChildNum]];

    let para = document.createElement('p');
    if (curChild.observationCount == undefined) {
        debugger;
    }
    para.textContent = curChild.name + ": " + curChild.observationCount + " observations with licensed photos";

    iNatPhotosDiv.innerHTML = "";
    iNatPhotosDiv.appendChild(para);
    iNatPhotosDiv.appendChild(curChild.makePhotos());

    
    if (curChildNum == parentTaxon.children.length - 1) {
        nextChildButton.disabled = true;
        nextChildButton.innerHTML = "last taxon";
    } else {
        nextChildPromise.then(() => {
            nextChildButton.disabled = false;
            nextChildButton.innerHTML = parentTaxon.children[curChildNum + 1].name + "  -->";
        })              
    }
    if (curChildNum == 0) {
        prevChildButton.disabled = true;
        prevChildButton.innerHTML = "first taxon";
    } else {   
        prevChildButton.disabled = false;
        prevChildButton.innerHTML = "<--  " + parentTaxon.children[curChildNum - 1].name;
    }

    if (!curChild.onLastPage()) {
        nextPhotosButton.disabled = false;
    }

    await children[childIds[curChildNum]].preloadPhotos()
    if (!children[childIds[curChildNum]].onLastPage()) {
        nextPhotosButton.disabled = false;
    }
    if (curChild.photoPos > 0) {
        prevPhotosButton.disabled = false;
    }
    document.querySelector("#photos-loading").innerHTML = "";
}

async function iNatAutoCompleteMake() {
    let results = await getJSON("https://api.inaturalist.org/v1/taxa/autocomplete?q=" + parentInput.value);
    let n = (results.total_results > 10) ? 10 : results.total_results;
    let autoCompleteList = document.createElement("ul");

    for (let i = 0; i < n; i++) {
        let curTax = new Taxon(results.results[i]);

        let item = document.createElement("li");
        item.innerHTML = curTax.formattedName();

        let button = document.createElement("button");
        button.className = "autocomplete-option";
        button.value = curTax.id;
        button.innerHTML = "select"
        item.appendChild(button);

        autoCompleteList.appendChild(item);
    }
    autocompleteResultsDiv.innerHTML = "";
    autocompleteResultsDiv.appendChild(autoCompleteList);
}

function dropDownAutoComplete() {
    iNatAutoCompleteMake();
    document.querySelector('#autocomplete-loading').innerHTML = "";
}

parentInput.addEventListener('input', () => {
    document.querySelector('#autocomplete-loading').innerHTML = "loading...";
    clearTimeout(inputWaitTimer)
    inputWaitTimer = setTimeout(dropDownAutoComplete, AUTOCOMPLETEWAIT);
});

document.querySelector('#autocomplete-results').addEventListener('click', async function(event) {
    if (event.target.nodeName != 'BUTTON') return;
    document.querySelector('#photos-loading').innerHTML = "loading...";
    children = {};
    childIds = [];

    let taxonID = event.target.value;
    let data = await getJSON("https://api.inaturalist.org/v1/taxa/" + taxonID);

    parentTaxon = new Taxon (data.results[0]);

    curChildNum = -1;
    await loadNextChild(true)

    curChildNum = 0;
    await displayChild()     
    
});

nextChildButton.addEventListener('click', async function() {
    nextChildButton.disabled = true;
    nextPhotosButton.disabled = true;
    prevPhotosButton.disabled = true;
    await nextChildPromise;
    curChildNum += 1;
    
    await displayChild()
    .catch(error => {
        alert("child api call error: " + error);
    });

});

prevChildButton.addEventListener('click', function() {
    prevChildButton.disabled = true;
    nextPhotosButton.disabled = true;
    prevPhotosButton.disabled = true;
    curChildNum -= 1;
    displayChild()
    .catch(error => {
        alert("child api call error: " + error);
    });
});

nextPhotosButton.addEventListener('click', async function() {
    iNatPhotosDiv.innerHTML = "Photos loaded: " + children[childIds[curChildNum]].photos.length;
    iNatPhotosDiv.appendChild(children[childIds[curChildNum]].nextPhotos());
    await children[childIds[curChildNum]].preloadPhotos()
    if (!children[childIds[curChildNum]].onLastPage()) {
        nextPhotosButton.disabled = false;
    }
});

prevPhotosButton.addEventListener('click', async function() {
    iNatPhotosDiv.innerHTML = "Photos loaded: " + children[childIds[curChildNum]].photos.length;
    iNatPhotosDiv.appendChild(children[childIds[curChildNum]].prevPhotos());
});

