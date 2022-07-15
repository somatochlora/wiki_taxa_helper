"use strict";

// Number of photos to display at a time
const PHOTODISPLAYNUM = 20;

let children = {};
let parentTaxon;
let childIds = [];
let curChildNum;

const iNatPhotosDiv = document.querySelector('#inat-photos');
const prevChildButton = document.querySelector('#prev-child');
const nextChildButton = document.querySelector('#next-child');
const prevPhotosButton = document.querySelector('#prev-photos');
const nextPhotosButton = document.querySelector('#next-photos');

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
        if (this.hasCommonName) this.name = this.commonName;
        else this.name = this.latinName;
    }

    addObservations(observationData) {        
        
        // this is NOT the same as the length of this.observations, as that only returns the number of observations in the current json request
        this.observationCount = observationData.total_results;

        // there is no way to get the numbers of licensed *photos* without making an arbitraryly large number of api requests

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
    }

    async getLicensedPhotos (maxId = -1) {
        let maxIdStr = "";
        if (maxId != -1) {
            maxIdStr = "&id_below=" + maxId;
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
    
    async loadChild () {
        let observationsData = await this.getLicensedPhotos()
        this.addObservations(observationsData)
        await this.getWikidataId();
    }

    async getMorePhotos (maxId) {
        let observationsData = await this.getLicensedPhotos(maxId)
        this.addObservations(observationsData)
    }

    makePhotos (start = 0) {
        let photosDiv = document.createElement('div');
        for (let i = start; i < start + PHOTODISPLAYNUM; i++) {
            if (i == this.photos.length) break;
            photosDiv.appendChild(this.photos[i].returnDiv());
        }
        return photosDiv;
    }
}

async function displayChild() {
    let curChild;
    if (curChildNum == childIds.length) {
        curChild = new Taxon(parentTaxon.children[curChildNum]);
        childIds.push(curChild.id);
        children[childIds[curChildNum]] = curChild;

        await curChild.loadChild()
    } else {
        curChild = children[childIds[curChildNum]];
    }

    let para = document.createElement('p');

    para.textContent = curChild.name + ": " + curChild.observationCount + " observations with licensed photos";

    iNatPhotosDiv.innerHTML = "";
    iNatPhotosDiv.appendChild(para);
    iNatPhotosDiv.appendChild(curChild.makePhotos());

    if (curChildNum == parentTaxon.children.length - 1) {
        nextChildButton.disabled = true;
        nextChildButton.innerHTML = "last taxon";
    } else {
        nextChildButton.disabled = false;
        nextChildButton.innerHTML = parentTaxon.children[curChildNum + 1].name + "  -->";
    }
    if (curChildNum == 0) {
        prevChildButton.disabled = true;
        prevChildButton.innerHTML = "first taxon";
    } else {   
        prevChildButton.disabled = false;
        prevChildButton.innerHTML = "<--  " + parentTaxon.children[curChildNum - 1].name;
    }
}

document.querySelector('#taxonSubmit').addEventListener('click', function() {
    let taxonID = document.querySelector('#iNatTaxonID').value;
    getJSON("https://api.inaturalist.org/v1/taxa/" + taxonID)
    .then(data => {        
        
        parentTaxon = new Taxon (data.results[0]);

        curChildNum = 0;
        displayChild()     
        .catch(error => {
            alert("child api call error: " + error);
        });
    })
    .catch(error => {
        alert("parent api call error: " + error);
    });
});

nextChildButton.addEventListener('click', function() {
    curChildNum += 1;
    displayChild()
    .catch(error => {
        alert("child api call error: " + error);
    });
});

prevChildButton.addEventListener('click', function() {
    curChildNum -= 1;
    displayChild()
    .catch(error => {
        alert("child api call error: " + error);
    });
});


