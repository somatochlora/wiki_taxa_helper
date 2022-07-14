"use strict";

// Number of cild taxa to get at one time
const childSetNum = 10;

// Number of photos to display at a time
const photoDisplayNum = 20;

async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) // check if response worked (no 404 errors etc...)
        throw new Error(response.statusText);

    const data = response.json(); // get JSON from the response
    return data; // returns a promise, which resolves to this data value
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
    }

    addObservations(observationData) {
        this.observations = [];
        for (let observation of observationData) {
            let newObs = {};
            newObs.qualityGrade = observation.quality_grade;
            newObs.datetime = observation.time_observed_at;
            newObs.id = observation.id;
            newObs.geoprivacy = observation.geoprivacy;
            if (newObs.geoprivacy = null) newObs.geoprivacy = "open";
            newObs.photos = observation.photos;
            newObs.photoNum = newObs.photos.length;
            newObs.location = observation.location;

            this.observations.push(newObs);
        };
    }

    async getLicensedPhotos () {
        const data = await getJSON("https://api.inaturalist.org/v1/observations?photo_license=cc-by%2Ccc-by-sa%2Ccc0&taxon_id=" + this.id)
        return data;
    }

    async getWikidataID () {
        const sparqlQuery = `SELECT ?item
WHERE
{
?item wdt:P3151 "` + this.id + `".
}`;
        const data = await getJSON('https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparqlQuery) + '&format=json');
        this.wikidataID = data.results.bindings[0].item.value;
    }
}

document.querySelector('#taxonSubmit').addEventListener('click', function() {
    let taxonID = document.querySelector('#iNatTaxonID').value;
    getJSON("https://api.inaturalist.org/v1/taxa/" + taxonID)
    .then(data => {
        let resultsDiv = document.querySelector('#results');
        let taxa = {};
        let parentTaxon = new Taxon (data.results[0]);


        // TODO: add pagination to get all children

        for (let childIndex = 0; childIndex < parentTaxon.childrenNum; childIndex++) {
            let curChildID = parentTaxon.children[childIndex].id;
            taxa[curChildID] = new Taxon (parentTaxon.children[childIndex]);
            taxa[curChildID].getLicensedPhotos()
            .then(childData => {
                taxa[curChildID].getWikidataID()
                .then()
                .catch(error => alert("Wikidata API call error: " + error));
                let observationDiv = document.createElement('div');
                let para = document.createElement('p');
                let imagesDiv = document.createElement('div');

                taxa[curChildID].addObservations(childData.results);
                if (taxa[curChildID].hasCommonName) para.textContent = taxa[curChildID].commonName;
                else para.textContent = taxa[curChildID].latinName;
                para.textContent += ": " + childData.total_results + " observations with licensed photos";
                observationDiv.appendChild(para);

                if (childData.total_results != 0) {
                    for (let observationIndex = 0; observationIndex < taxa[curChildID].observations.length; observationIndex++) {                                    
                        for (let imageIndex = 0; imageIndex < taxa[curChildID].observations[observationIndex].photoNum; imageIndex++) {
                            
                            let link = document.createElement('a');
                            link.target = "_blank";
                            link.href = "https://www.inaturalist.org/observations/" + taxa[curChildID].observations[observationIndex].id;
                            link.id = childIndex + "," + observationIndex + "," + imageIndex;

                            let image = document.createElement('img');
                            // need to check license on each photo individually todo
                            image.src = taxa[curChildID].observations[observationIndex].photos[imageIndex].url;
                            let borderColour;
                            switch (taxa[curChildID].observations[observationIndex].qualityGrade) {
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

                            link.appendChild(image);
                            link.style = "margin:4px;"

                            imagesDiv.appendChild(link);
                        }
                        observationDiv.appendChild(imagesDiv);
                    } 
                }                           
                resultsDiv.appendChild(observationDiv);

                /*getWikiDataTaxon(data.results[0].children[i].id).then(wdData => {
                    alert(wdData);
                }).catch(error => alert("error here" + error));*/

            })
            .catch(error => {
                alert("children api call error:" + error)
            });                  
        }
    })
    .catch(error => {
        alert("parent api call error:" + error);
    });
});


