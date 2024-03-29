"use strict";

// Returns an object from the api when given the url
async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) // check if response worked (no 404 errors etc...)
        throw new Error(response.statusText);

    const data = response.json(); // get JSON from the response
    return data; // returns a promise, which resolves to this data value
}

class iNaturalistObjects {
    constructor() {
        this.length = 0;
        this.ids = []
    }

    add(item) {
        this[item.id] = item;
        this.ids.push(item.id);
        this.length += 1;
    }

    getByIndex(index) {
        return this[this.ids[index]];
    }

    empty() {        
        for (let i = 0; i < this.length; i++) {
            delete this[this.ids[i]];
        }
        this.ids = [];
        this.length = 0;
    }
}

class Photo {
    constructor(url) {
        this.url = url;
        this.borderColour = "gray";
    }

    returnDiv() {
        let image = document.createElement('img');
        image.src = this.url;
        image.style = "border:4px solid " + this.borderColour + "; border-radius:15px;";
        let button = document.createElement('button');
        button.style = "margin:4px; padding:4px;";
        button.value = this.buttonValue;
        button.appendChild(image); 
        return button;
    }
}

// Each photo returned from iNaturalist is an instance of this class
class iNatPhoto extends Photo {
    constructor(observationData, photoNum, observationRef) {
        super(observationData.photos[photoNum].url);
        // unique iNat photo ID
        this.id = observationData.photos[photoNum].id;
        this.license = observationData.photos[photoNum].license_code;

        // string for the person who uploaded the photo
        this.attribution = observationData.photos[photoNum].attribution;

        // iNat id of the observation this photo belongs to
        this.observationId = observationData.id;

        this.observationRef = observationRef;

        // research grade, needs id, or casual
        this.qualityGrade = observationData.quality_grade;

        this.observationRef = observationRef;

        switch (this.qualityGrade) {
            case "research": 
                this.borderColour = "green";
                break;
            case "needs_id":
                this.borderColour = "yellow";
                break;
            case "casual":
                this.borderColour = "red";
                break;
        }

        this.buttonValue = this.id;
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

    getTaxonName() {
        return this.observationRef.taxonName;
    }

    getSizeUrl(size) {
        //size can be square, small, medium, large, original
        return this.url.replace("square", size);
    }

}

class CommonsPhoto extends Photo {
    constructor (commonsPage) {
        commonsPage = commonsPage.replaceAll(" ", "_");
        commonsPage = commonsPage.replace("File:" , "");
        super("https://commons.wikimedia.org/w/thumb.php?f=" + commonsPage + "&w=75");
        //("https://commons.wikimedia.org/wiki/File:" + commonsPage)
        this.commonsPage = commonsPage;
        this.id = commonsPage; //user for "inaturalistObjects" class;
        this.buttonValue = commonsPage;
        this.dataRetrieved = false;
    }

    isPhoto() {
        let filetype = this.commonsPage.slice(this.commonsPage.lastIndexOf(".")).toLowerCase();
        console.log(filetype);
        switch (filetype) {
            case ".jpg":
            case ".jpeg":
            case ".png":
            case ".gif":
                return true;
        }
        return false;
    }

    async getInfo() {
        if (this.dataRetrieved) {
            return this.dataResult;
        }
        let data = await getJSON("https://en.wikipedia.org/w/api.php?action=query&titles=File:" + this.commonsPage + "&format=json&origin=*&prop=imageinfo&iiprop=timestamp|user|userid|url|size|mediatype|comment|commonmetadata")
        let result = {};
        console.log(data);
        // todo need to use api to get info from the photo page, not just that attached to the file
        result.url = "https://commons.wikimedia.org/w/thumb.php?f=" + this.commonsPage + "&w=500"
        result.linkUrl = data.query.pages[-1].imageinfo[0].descriptionurl;
        result.uploader = data.query.pages[-1].imageinfo[0].user;
        this.dataResult = result;
        return result;
    }
}

class GenericTaxon {
    constructor (latinName, commonName, rank) {
        this.latinName = latinName;
        this.commonName = commonName;
        this.hasCommonName = (this.commonName != undefined);
        this.rank = rank;
    }

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
}

class iNatTaxon extends GenericTaxon {
    constructor(taxonData) {
        super(taxonData.name, taxonData.preferred_common_name, taxonData.rank);
        if (this.rank == "hybrid") this.rank = "species"; // this is a hacky fix need to make better
        if (this.rank == "genushybrid") this.rank = "genus";
        this.numericRank = TAXONOMYSTRUCTURE.indexOf(this.rank);
        this.id = taxonData.id;
    }
}

class ParentiNatTaxon extends iNatTaxon {
    constructor(taxonData, parent = false) {
        super(taxonData);
        this.childrenData = taxonData.children;
        this.children = [];
        this.hasMoreChildren = (this.childrenData != undefined);
        if (this.hasMoreChildren) {
            this.childrenNum = this.childrenData.length;
        }

        this.treeLoaded = false;
        this.parent = parent;        
        this.traversalPointer = this;

        this.taxonData = taxonData;
    }

    async nextLeaf2(lowRank) {
        let nextFound = false;
        let result = 0;
        let taxonData = this.traversalPointer.taxonData;

        for (let i = 0; i < MAXNUMBEROFSEARCHSTEPS; i++) {
            console.log(this.traversalPointer.formattedName());
            
            // case found a leaf
            if (this.traversalPointer.numericRank >= lowRank) {
                              
                if (nextFound) {
                    console.log("found next leaf");
                    return result;
                } else {
                    console.log("found this leaf");       
                    result = new PhotoiNatTaxon(this.traversalPointer, true);
                    nextFound = true;  
                    if (this.traversalPointer == this) {
                        this.treeLoaded = true;
                    } else {
                        this.traversalPointer = this.traversalPointer.parent; 
                    }                               
                }
            } else if (this.traversalPointer.childrenData.length > 0) { //case we need to move down a level
                console.log("moving down a level");
                taxonData = await getJSON("https://api.inaturalist.org/v1/taxa/" + this.traversalPointer.childrenData[0].id);
                let newChild = new ParentiNatTaxon (taxonData.results[0], this.traversalPointer);        
                this.traversalPointer.childrenData.shift();
                this.traversalPointer = newChild;
            } else { //case we need to move up a level
                console.log("moving up a level");
                
                if (this.traversalPointer == this && this.childrenData.length == 0) {
                    this.treeLoaded = true;
                    return result;
                }
                this.traversalPointer = this.traversalPointer.parent;
            }
        }

        // no leaves found after a limited number of searches
        this.treeLoaded = true;
        if (result === 0) {
            console.log("no leaves found");
            return -1;
        }
        console.log("last leaf found");
        return result;

    }
}

class PhotoiNatTaxon extends iNatTaxon {
    constructor(taxonData, override) {
        if (override) {
            let objectPass = {name: taxonData.latinName, preferred_common_name: taxonData.commonName,
            rank: taxonData.rank, id: taxonData.id};
            super (objectPass);
        } else {
            super (taxonData);
        }        
        this.observations = new iNaturalistObjects();
        this.photos = {};
        this.photoIds = [];

        // index of the first photo currently displayed
        this.photoPos = 0;

        // the smallest ID of all observations currently loaded, used for pagination
        this.curMaxId = -1;
        this.photosLoaded = false;
        
        this.commonsPhotos = new iNaturalistObjects;
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
                let curPhoto = new iNatPhoto(observation, i, newObs);
                if (curPhoto.isLicensed()) this.photos[curPhoto.id] = curPhoto; // it is possible for only some of the photos in an observation to be freely licensed
                this.photoIds.push(curPhoto.id);
            }
            newObs.location = observation.location;

            let tmp = new iNatTaxon(observation.taxon);
            newObs.taxonName = tmp.formattedName();

            this.observations.add(newObs);
        };

        this.curMaxId = this.observations.getByIndex(this.observations.length - 1).id;
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
    async loadWikidata () {
        if (this.wikidataLoaded) {
            console.log("already loaded wikidata")
            return;
        }
        let results = await wikidataQuery(this.id);
        if (results.results.bindings.length === 0) {
            this.wikidataId = false;
            this.commonsURL = false;
            this.wikiURL = false;
            /* TODO
            let searchResults = await getJSON("https://www.wikidata.org/w/api.php?action=query&list=search&format=json&origin=*&srsearch=" + encodeURIComponent(this.latinName));
            searchResults = searchResults.query.search;
            console.log(searchResults);
            */
        } else {
            this.wikidataId = results.results.bindings[0].taxon.value;
            this.wikidataId = this.wikidataId.slice(this.wikidataId.indexOf("Q"));

            let commonsResults = await wikidataQuery(this.id, "https://commons.wikimedia.org/");
            let wikiResults = await wikidataQuery(this.id, "https://en.wikipedia.org/");

            if (commonsResults.results.bindings.length === 0) {
                this.commonsURL = false;
            } else {
                this.commonsURL = commonsResults.results.bindings[0].article.value;
                if ( this.commonsURL.indexOf("Category") == -1) {
                    this.commonsURL = this.commonsURL.replace("wiki/", "wiki/Category:");
                }
                this.commonsPage = this.commonsURL.replace("https://commons.wikimedia.org/wiki/", "");
                this.commonsPhotoData = await getJSON("https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&format=json&origin=*&cmtype=file&cmtitle=" + this.commonsPage);
                console.log(this.commonsPhotoData);
            }
            

            if (wikiResults.results.bindings.length === 0) {
                this.wikiURL = false;
            } else {
                this.wikiURL = wikiResults.results.bindings[0].article.value;
                this.wikiPage = this.wikiURL.replace("https://en.wikipedia.org/wiki/", "");
            }
            
        }
        this.wikidataLoaded = true;
        
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

    //checks that we are not already on the last child
    if ((curLeafNum < leaves.length - 1 && !override) || (parentTaxon.treeLoaded)) {
        console.log("next child not being loaded");
        return false;
    }

    console.log("next child being loaded");
    console.log(parentTaxon.formattedName());
    let tmp = await parentTaxon.nextLeaf2(targetRank);

    if(tmp !== -1) {
        leaves.add(tmp);
        await tmp.loadPhotos();
        return true;
    }
    return false;

}

// displays the current child taxon and preloads the next
async function displayChild() {
    
    hideAllSections();
    // starts preloading the next child
    nextChildPromise = loadNextChild();


    console.log(curLeafNum);
    let curChild = leaves.getByIndex(curLeafNum);

    let wikidataLoaded = curChild.loadWikidata();

    let para = document.createElement('p');

    para.innerHTML = curChild.formattedName() + ": " + curChild.observationCount + " observations with licensed photos";

    iNatPhotosDiv.innerHTML = "";
    iNatPhotosDiv.appendChild(para);
    iNatPhotosDiv.appendChild(curChild.makePhotos());

    // enables/disables the buttons for navigating between children as necessarry 
    
    nextChildPromise.then(() => {
        if (curLeafNum == leaves.length - 1) {
            nextChildButton.disabled = true;
            nextChildButton.innerHTML = "last taxon";
        } else {
            nextChildButton.disabled = false;
            nextChildButton.innerHTML = leaves.getByIndex(curLeafNum + 1).formattedName() + "  -->";
        }
    });

    if (curLeafNum == 0) {
        prevChildButton.disabled = true;
        prevChildButton.innerHTML = "first taxon" ;
    } else {   
        prevChildButton.disabled = false;
        prevChildButton.innerHTML = "<--  " + leaves.getByIndex(curLeafNum - 1).formattedName();
    }

    // enables/disables the buttons for navigating between photos as necessarry 
    if (!curChild.onLastPage()) {
        nextPhotosButton.disabled = false;
    }

    await leaves.getByIndex(curLeafNum).preloadPhotos()
    if (!leaves.getByIndex(curLeafNum).onLastPage()) {
        nextPhotosButton.disabled = false;
    }
    if (curChild.photoPos > 0) {
        prevPhotosButton.disabled = false;
    }
    document.querySelector("#photos-loading").innerHTML = "";
    document.querySelector("#inat-photos").hidden = false;

    document.querySelector("#commons-photos").innerHTML = "";
    await wikidataLoaded;
    if (!curChild.wikidataId) {
        document.querySelector("#wikidata-id").innerHTML = "no Wikidata connection found";
        document.querySelector("#commons-url").innerHTML = "";
        document.querySelector("#wikipedia-url").innerHTML = "";

    } else {
        document.querySelector("#wikidata-id").innerHTML = "Wikidata ID: " + curChild.wikidataId;
        if (!curChild.commonsURL) {
            document.querySelector("#commons-url").innerHTML = "no Commons page found";
        } else {
            let link = document.createElement("a");
            link.href = curChild.commonsURL;
            link.target = "_blank";
            link.innerHTML = curChild.commonsPage;
            document.querySelector("#commons-url").innerHTML = "Commons page: ";
            document.querySelector("#commons-url").appendChild(link);
            if (curChild.commonsPhotoData?.query?.categorymembers.length > 0) {
                for (let photo of curChild.commonsPhotoData.query.categorymembers) {
                    let curPhoto = new CommonsPhoto(photo.title);
                    if (curPhoto.isPhoto()) {
                        curChild.commonsPhotos.add(curPhoto);
                        document.querySelector("#commons-photos").appendChild(curPhoto.returnDiv());
                    }
                }
            }
            

        }
        if (!curChild.wikiURL) {
            document.querySelector("#wikipedia-url").innerHTML = "no English Wikipedia page found";
        } else {
            let link = document.createElement("a");
            link.href = curChild.wikiURL;
            link.target = "_blank";
            link.innerHTML = curChild.wikiPage;
            document.querySelector("#wikipedia-url").innerHTML = "English Wikipedia page: ";
            document.querySelector("#wikipedia-url").appendChild(link);
        }
    }
    document.querySelector("#wikidata").hidden = false;
}

// creatse the html for the autocomplete results
async function iNatAutoCompleteMake() {
    let results = await getJSON("https://api.inaturalist.org/v1/taxa/autocomplete?q=" + parentInput.value);
    
    // caps the autocomplete results dislpayed at 10
    let n = (results.total_results > 10) ? 10 : results.total_results;
    let autoCompleteList = document.createElement("ul");

    for (let i = 0; i < n; i++) {
        let curTax = new iNatTaxon(results.results[i]);

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
    autocompleteResultsDiv.hidden=false;
}

function dropDownAutoComplete() {
    iNatAutoCompleteMake();
    document.querySelector('#autocomplete-loading').innerHTML = "";
}

async function wikidataQuery (taxon, url = false) {
    let insert1 = "";
    let insert2 = "";
    if (url) {
        insert1 = ' ?article ';
        insert2 = `?article schema:about ?taxon .
?article schema:isPartOf <` + url + '> .';
    }
    let query = `SELECT ?taxon` + insert1 + ` WHERE
{
?taxon wdt:P3151 "` + taxon + `".
` + insert2 + `
}`;
    const data = await getJSON('https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json&origin=*');
    return data;
}

function hideAllSections () {
    document.querySelector("#autocomplete-results").hidden = true;
    document.querySelector("#inat-photos").hidden = true;
    document.querySelector("#wikidata").hidden = true;
}


// Number of photos to display at a time
// This will also be the number of observations retrieved at one time
const PHOTODISPLAYNUM = 20;

// Milliseconds to wait after user stops typing to display autocomplete results. Necessarry to ensure we don't spam the api
const AUTOCOMPLETEWAIT = 500;

const TAXONOMYSTRUCTURE = ["kingdom", "phylum", "subphylum", "superclass", "class", "subclass", "superorder", "order", 
"suborder", "infraorder", "superfamily", "epifamily", "family", "subfamily", "supertribe", "tribe", "subtribe", "genus", "subgenus", "section",
"species", "subspecies", "variety", "form"];

const MAXNUMBEROFSEARCHSTEPS = 20;

// All taxa with photos loaded, keyed by iNat ID [type: Taxon]
let leaves = new iNaturalistObjects;

// The taxon selected from the search bar/autocomplete [type: Taxon]
let parentTaxon;

// The current child that is being displayed with photos
let curLeafNum;

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

let targetRank = TAXONOMYSTRUCTURE.indexOf("species");

let rankDropDown = document.querySelector("#rank");
    for (let rank of TAXONOMYSTRUCTURE) {
        let item = document.createElement("option");
        item.value = rank;
        item.innerHTML = rank;
        if (rank == "species") item.selected = true;
        rankDropDown.appendChild(item)
    }
rankDropDown.hidden = false;

rankDropDown.addEventListener('change', () => {
    targetRank = TAXONOMYSTRUCTURE.indexOf(rankDropDown.value);
});

parentInput.addEventListener('input', () => {
    document.querySelector('#autocomplete-loading').innerHTML = "loading...";
    clearTimeout(inputWaitTimer)
    inputWaitTimer = setTimeout(dropDownAutoComplete, AUTOCOMPLETEWAIT);
});

// activates when one of the autocomplete results is selected
document.querySelector('#autocomplete-results').addEventListener('click', async function(event) {
    if (event.target.nodeName != 'BUTTON') return;

    nextChildButton.disabled = true;
    prevChildButton.disabled = true;    
    nextPhotosButton.disabled = true;
    prevPhotosButton.disabled = true;

    document.querySelector('#photos-loading').innerHTML = "loading...";
    leaves.empty();
    document.querySelector('#autocomplete-results').innerHTML = "";

    let taxonID = event.target.value;
    let data = await getJSON("https://api.inaturalist.org/v1/taxa/" + taxonID);

    parentTaxon = new ParentiNatTaxon (data.results[0]);
    
    curLeafNum = -1;
    await loadNextChild(true)

    curLeafNum = 0;
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
    curLeafNum += 1;
    
    await displayChild()
    .catch(error => {
        alert("child api call error: " + error);
    });

});

prevChildButton.addEventListener('click', function() {
    prevChildButton.disabled = true;
    nextPhotosButton.disabled = true;
    prevPhotosButton.disabled = true;
    curLeafNum -= 1;
    displayChild()
    .catch(error => {
        alert("child api call error: " + error);
    });
});

nextPhotosButton.addEventListener('click', async function() {

    iNatPhotosDiv.removeChild(document.querySelector("#photos-page"));
    iNatPhotosDiv.appendChild(leaves.getByIndex(curLeafNum).nextPhotos());
    await leaves.getByIndex(curLeafNum).preloadPhotos()
    if (!leaves.getByIndex(curLeafNum).onLastPage()) {
        nextPhotosButton.disabled = false;
    }
});

prevPhotosButton.addEventListener('click', async function() {
    iNatPhotosDiv.removeChild(document.querySelector("#photos-page"));
    iNatPhotosDiv.appendChild(leaves.getByIndex(curLeafNum).prevPhotos());
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
    let curTaxon = leaves.getByIndex(curLeafNum);
    let curImg = curTaxon.photos[curImgId];
    let curObs = curImg.observationRef;

    let imgHtml = document.createElement("img");
    imgHtml.src = curImg.getSizeUrl("medium");

    document.querySelector('#photo-modal-photo').innerHTML = "";
    document.querySelector('#photo-modal-photo').appendChild(imgHtml);

    document.querySelector('#photo-modal-text').innerHTML = "";
    let paras = [];
    paras.push(curImg.getTaxonName());
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

document.querySelector('#commons-photos').addEventListener('click', async function(event) {
    let curPhotoName;
    if (event.target.nodeName == 'BUTTON') {
        curPhotoName = event.target.value;
    } else if (event.target.nodeName == 'IMG') {
        curPhotoName = event.target.parentNode.value;
    } else {
        return;
    }
    let curTaxon = leaves.getByIndex(curLeafNum);
    let curPhoto = curTaxon.commonsPhotos[curPhotoName];
    let data = await curPhoto.getInfo();

    let imgHtml = document.createElement("img");
    imgHtml.src = data.url;

    document.querySelector('#photo-modal-photo').innerHTML = "";
    document.querySelector('#photo-modal-photo').appendChild(imgHtml);

    document.querySelector('#photo-modal-text').innerHTML = "";
    let paras = [];
    paras.push(curPhoto.commonsPage);
    paras.push("Uploaded by: " + data.uploader);
    let link = document.createElement("a");
    link.innerHTML = "Commons Link";
    link.href = data.linkUrl;
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
