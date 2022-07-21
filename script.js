"use strict";

// Number of photos to display at a time
// This will also be the number of observations retrieved at one time
const PHOTODISPLAYNUM = 20;

// Milliseconds to wait after user stops typing to display autocomplete results. Necessarry to ensure we don't spam the api
const AUTOCOMPLETEWAIT = 500;

const TAXONOMYSTRUCTURE = ["kingdom", "phylum", "subphylum", "superclass", "class", "subclass", "superorder", "order", 
"suborder", "infraorder", "superfamily", "epifamily", "family", "subfamily", "supertribe", "tribe", "subtribe", "genus", "subgenus", "section",
"species", "subspecies", "variety", "form"];

// All taxa with photos loaded, keyed by iNat ID [type: Taxon]
let leaves = {};

// The taxon selected from the search bar/autocomplete [type: Taxon]
let parentTaxon;

// Ordered list of ids for the children
let childIds = [];

// The current child that is being displayed with photos
let curChildNum;

// A promise that resolves when the next child is fully loaded
let nextChildPromise;

// A timer that resets any time there is input in the main search bar
let inputWaitTimer;

// Quick references for various html elements
const parentInput = document.querySelector("#iNatTaxonID");
const iNatPhotosDiv = document.querySelector('#inat-photos');
const prevChildButton = document.querySelector('#prev-child');
const nextChildButton = document.querySelector('#next-child');
const prevPhotosButton = document.querySelector('#prev-photos');
const nextPhotosButton = document.querySelector('#next-photos');
const autocompleteResultsDiv = document.querySelector('#autocomplete-results');
const photoModal = document.querySelector("#photo-modal");

// Returns an object from the api when given the url
async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) // check if response worked (no 404 errors etc...)
        throw new Error(response.statusText);

    const data = response.json(); // get JSON from the response
    return data; // returns a promise, which resolves to this data value
}

// Each photo returned from iNaturalist is an instance of this class
class Photo {
    constructor(observationData, photoNum, observationRef) {
        // unique iNat photo ID
        this.id = observationData.photos[photoNum].id;
        this.license = observationData.photos[photoNum].license_code;
        this.url = observationData.photos[photoNum].url;

        // string for the person who uploaded the photo
        this.attribution = observationData.photos[photoNum].attribution;

        // iNat id of the observation this photo belongs to
        this.observationId = observationData.id;

        // research grade, needs id, or casual
        this.qualityGrade = observationData.quality_grade;

        this.observationRef = observationRef;
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

    // returns a formatted html element for the photo
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
        image.style = "border:4px solid " + borderColour + "; border-radius:15px;";

        let button = document.createElement('button');
        //link.target = "_blank";
        //link.href = "https://www.inaturalist.org/observations/" + this.observationId;     
        button.style = "margin:4px; padding:4px;";
        button.value = this.id;

        button.appendChild(image);       

        return button;
    }

    getSizeUrl(size) {
        //size can be square, small, medium, large, original
        return this.url.replace("square", size);
    }

}

// various methods for interacting with taxa returned from iNat
class Taxon {
    constructor(taxonData, parent = false) {
        // unique iNaturalist id
        this.id = taxonData.id;
        this.latinName = taxonData.name;
        this.rank = taxonData.rank
        this.numericRank = TAXONOMYSTRUCTURE.indexOf(this.rank);

        //array of child taxa
        this.childrenData = taxonData.children;
        this.children = [];
        this.hasMoreChildren = (this.childrenData != undefined);
        if (this.hasMoreChildren) {
            this.childrenNum = this.childrenData.length;
            this.childrenData = this.childrenData.reverse();
        }

        this.commonName = taxonData.preferred_common_name;
        this.hasCommonName = (this.commonName != undefined);

        this.observations = [];
        this.photos = {};
        this.photoIds = [];

        // index of the first photo currently displayed
        this.photoPos = 0;

        // the smallest ID of all observations currently loaded, used for pagination
        this.curMaxId = -1;

        if (this.hasCommonName) this.name = this.commonName;
        else this.name = this.latinName;

        // true when every observation and photo has been loaded
        this.photosLoaded = false;

        this.treeLoaded = false;
        this.parent = parent;
        this.traversalPointer = this;
    }

    async nextLeaf(lowRank, treeBase = this) {

        alert("species: " + this.name + " rank: " + this.rank + " " + this.numericRank);

        // case the parent taxon has no children
        if (this == treeBase && !this.hasMoreChildren && this.children.length == 0) {
            return this;
        }
        
        if (this == treeBase) {
            
            return this.traversalPointer.nextLeaf();
        }

        // case we have found a leaf
        if (this.numericRank >= lowRank) {
            alert("found leaf: " + this.name);
            this.parent.childrenData.pop();
            return this;
        }

        // case we are done with this node and need to move up a level
        
        if (!this.hasMoreChildren) {
            treeBase.traversalPointer = this.parent;
            this.parent.childrenData.pop();
            let tmp = await this.nextLeaf(lowRank, treeBase);
            return tmp;
        }

        treeBase.traversalPointer = this;

        let data = await getJSON("https://api.inaturalist.org/v1/taxa/" + this.childrenData[this.childrenData.length - 1].id);
        let newChild = new Taxon (data.results[0], this);        
        this.children.push(newChild);

        if (this.childrenData.length == 0) {
            this.hasMoreChildren = false;
        }
        let tmp = await newChild.nextLeaf(lowRank, treeBase);
        return tmp;
    }

    // a nicely formatted name to use in output
    formattedName() {
        let latinName = this.latinName;
        if (this.rank == "species" || this.rank == "genus" || this.rank == "subspecies") {
            latinName = "<i>" + latinName + "</i>";
        }
        if (this.hasCommonName) {
            return this.commonName + " (" + latinName + ") ";
        }
        return latinName;
    }

    // loads all the observations and photos from a single api call
    addObservations(observationData) {        
        
        // this is NOT the same as the length of this.observations, as that only returns the number of observations in the current json request
        if (this.photoIds.length == 0) {
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
            if (newObs.geoprivacy = null) newObs.geoprivacy = "open";  // if an iNat observation geoprivacy has never been changed, it will show up as "null"          
            for (let i = 0; i < observation.photos.length; i++) {
                let curPhoto = new Photo(observation, i, newObs);
                if (curPhoto.isLicensed()) this.photos[curPhoto.id] = curPhoto; // it is possible for only some of the photos in an observation to be freely licensed
                this.photoIds.push(curPhoto.id);
            }
            newObs.location = observation.location;

            this.observations.push(newObs);
        };

        this.curMaxId = this.observations[this.observations.length - 1].id;
    }

    // Will do an api call to retrieve the next set of observations with freely licensed photos
    async getLicensedPhotos () {
        let maxIdStr = "";
        if (this.curMaxId != -1) {
            maxIdStr = "&id_below=" + this.curMaxId;
        }
        let perPageStr = "&per_page=" + PHOTODISPLAYNUM;
        const data = await getJSON("https://api.inaturalist.org/v1/observations?photo_license=cc-by%2Ccc-by-sa%2Ccc0&taxon_id=" + this.id + maxIdStr + perPageStr)
        return data;
    }

    // will return the wikidata id for the taxon if available
    async getWikidataId () {
        const sparqlQuery = `SELECT ?item
WHERE
{
?item wdt:P3151 "` + this.id + `".
}`;
        const data = await getJSON('https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparqlQuery) + '&format=json');
        this.wikidataID = data?.results?.bindings[0]?.item?.value;
    }
    
    // load the first set of photos
    async loadPhotos () {
        this.addObservations(await this.getLicensedPhotos());
        if (this.observationCount == this.observations.length) {
            this.photosLoaded = true;
        }
    }

    // used for loading the next set of photos TODO can probably be combined with the above
    async preloadPhotos () {
        if (this.photosLoaded) {
            return;
        }
        if (this.photoIds.length - this.photoPos < PHOTODISPLAYNUM * 2) {
            this.addObservations(await this.getLicensedPhotos());
        }
        if (this.observationCount == this.observations.length) {
            this.photosLoaded = true;
        }
    }

    // create an html element containing the current set of photos
    makePhotos () {
        let photosDiv = document.createElement('div');
        for (let i = this.photoPos; i < this.photoPos + PHOTODISPLAYNUM; i++) {
            if (i == this.photoIds.length) break;
            photosDiv.appendChild(this.photos[this.photoIds[i]].returnDiv());
        }
        photosDiv.id = "photos-page";
        return photosDiv;
    }

    // go to the next page of photos
    nextPhotos () {
        nextPhotosButton.disabled = true;
        this.photoPos += PHOTODISPLAYNUM;
        prevPhotosButton.disabled = false;      
        return this.makePhotos();
    }

    // go to the previous page of photos
    prevPhotos () {
        prevPhotosButton.disabled = true;
        this.photoPos -= PHOTODISPLAYNUM;
        nextPhotosButton.disabled = false;
        if (this.photoPos > 0) {
            prevPhotosButton.disabled = false;
        }
        return this.makePhotos();
    }

    // checks whether there are any more pages of photos
    onLastPage () {
        if (this.photoIds.length - this.photoPos <= PHOTODISPLAYNUM) {
            return true;
        }
        return false;
    }

}

// preloads the next child taxa before it needs to be displayed
async function loadNextChild(override = false) {
    // override is so we can use this function to load the very first child
    // the other two expressions check that (a) we are not already at the last child so no preloading necessary, and
    // (b) that the next child is not already loaded
    if ((curChildNum != parentTaxon.childrenData.length - 1 && curChildNum == childIds.length - 1) || override) {
        let curChild = new Taxon(parentTaxon.childrenData[curChildNum + 1]);
        childIds.push(curChild.id);
        leaves[childIds[curChildNum + 1]] = curChild;
        await curChild.loadPhotos()
    }
    // Still throwing erros when a child taxon has no photos TODO
    return true;
}

// displays the current child taxon and preloads the next
async function displayChild() {
    
    // starts preloading the next child
    nextChildPromise = loadNextChild();

    let curChild = leaves[childIds[curChildNum]];

    let para = document.createElement('p');

    para.textContent = curChild.name + ": " + curChild.observationCount + " observations with licensed photos";

    iNatPhotosDiv.innerHTML = "";
    iNatPhotosDiv.appendChild(para);
    iNatPhotosDiv.appendChild(curChild.makePhotos());

    // enables/disables the buttons for navigating between children as necessarry 
    if (curChildNum == parentTaxon.childrenData.length - 1) {
        nextChildButton.disabled = true;
        nextChildButton.innerHTML = "last taxon";
    } else {
        // only enables the next child button when the next child is loaded
        nextChildPromise.then(() => {
            nextChildButton.disabled = false;
            nextChildButton.innerHTML = parentTaxon.childrenData[curChildNum + 1].name + "  -->";
        })              
    }
    if (curChildNum == 0) {
        prevChildButton.disabled = true;
        prevChildButton.innerHTML = "first taxon";
    } else {   
        prevChildButton.disabled = false;
        prevChildButton.innerHTML = "<--  " + parentTaxon.childrenData[curChildNum - 1].name;
    }

    // enables/disables the buttons for navigating between photos as necessarry 
    if (!curChild.onLastPage()) {
        nextPhotosButton.disabled = false;
    }

    await leaves[childIds[curChildNum]].preloadPhotos()
    if (!leaves[childIds[curChildNum]].onLastPage()) {
        nextPhotosButton.disabled = false;
    }
    if (curChild.photoPos > 0) {
        prevPhotosButton.disabled = false;
    }
    document.querySelector("#photos-loading").innerHTML = "";
}

// creatse the html for the autocomplete results
async function iNatAutoCompleteMake() {
    let results = await getJSON("https://api.inaturalist.org/v1/taxa/autocomplete?q=" + parentInput.value);
    
    // caps the autocomplete results dislpayed at 10
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
    leaves = {};
    childIds = [];
    document.querySelector('#autocomplete-results').innerHTML = "";

    let taxonID = event.target.value;
    let data = await getJSON("https://api.inaturalist.org/v1/taxa/" + taxonID);

    parentTaxon = new Taxon (data.results[0]);
    let tmp = await parentTaxon.nextLeaf(20);
    alert("final: " + tmp.name);
    tmp = await parentTaxon.nextLeaf(20);
    alert("final: " + tmp.name);
    tmp = await parentTaxon.nextLeaf(20);
    alert("final: " + tmp.name);
    tmp = await parentTaxon.nextLeaf(20);
    alert("final: " + tmp.name);
    tmp = await parentTaxon.nextLeaf(20);
    alert("final: " + tmp.name);
    curChildNum = -1;
    await loadNextChild(true)

    curChildNum = 0;
    await displayChild()
    nextChildButton.hidden = false;
    prevChildButton.hidden = false;    
    nextPhotosButton.hidden = false;
    prevPhotosButton.hidden = false;  
    
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

    iNatPhotosDiv.removeChild(document.querySelector("#photos-page"));
    iNatPhotosDiv.appendChild(children[childIds[curChildNum]].nextPhotos());
    await leaves[childIds[curChildNum]].preloadPhotos()
    if (!leaves[childIds[curChildNum]].onLastPage()) {
        nextPhotosButton.disabled = false;
    }
});

prevPhotosButton.addEventListener('click', async function() {
    iNatPhotosDiv.removeChild(document.querySelector("#photos-page"));
    iNatPhotosDiv.appendChild(leaves[childIds[curChildNum]].prevPhotos());
});

document.querySelector('#inat-photos').addEventListener('click', function(event) {
    let curImgId;
    if (event.target.nodeName == 'BUTTON') {
        curImgId = event.target.value;
    } else if (event.target.nodeName == 'IMG') {
        curImgId = event.target.parentNode.value;
    } else {
        return;
    }
    let curTaxon = leaves[childIds[curChildNum]];
    let curImg = curTaxon.photos[curImgId];
    let curObs = curImg.observationRef;

    let imgHtml = document.createElement("img");
    imgHtml.src = curImg.getSizeUrl("medium");

    document.querySelector('#photo-modal-photo').innerHTML = "";
    document.querySelector('#photo-modal-photo').appendChild(imgHtml);

    document.querySelector('#photo-modal-text').innerHTML = "";
    let paras = [];
    paras.push(curTaxon.formattedName());
    paras.push(curObs.location);
    paras.push(curObs.datetime);
    paras.push(curImg.attribution);
    let link = document.createElement("a");
    link.innerHTML = "iNaturalist Observation Link";
    link.href = "https://www.inaturalist.org/observations/" + curObs.id;
    link.target = "_blank";

    for (let i = 0; i < paras.length; i++) {
        let para = document.createElement("p");
        para.innerHTML = paras[i];
        document.querySelector('#photo-modal-text').appendChild(para);
    }
    document.querySelector('#photo-modal-text').appendChild(link);

    photoModal.style.display = "block";
});

document.querySelector('#close-photo-modal').addEventListener('click', function(event) {
    photoModal.style.display = "none";
});

document.querySelector('#photo-modal').addEventListener('click', function (event) {
    if (event.target.id == 'photo-modal') {
        photoModal.style.display = "none";
    }
});
