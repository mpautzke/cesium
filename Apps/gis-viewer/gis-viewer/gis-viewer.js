// TODO: Get rid of proxies and make sure the throttling works right.
// TODO: Optimize mapserver latency
// TODO: Tweak JPEG tile quality
// TODO: Figure out how to discard white tiles.
// TODO: Find a better way to trigger loading of base layers.
// TODO: Error handling in XMLHttpRequest *
// TODO: XmlHttpRequest.onload
// TODO: Javascript compile
// TODO: Soil symbol centering *
// TODO: Primitives Z fighting 
// TODO: Insert primitives in correct order
// TODO: Shapefile import
// TODO: Aerial image jpeg
function WingScanGis()
{
    var widget;
    var viewerPath;
    var baseTileProvider;
    var loadTimer;
    var callBackObject;
    var CommandModes = {NONE:0,FINDING_FIELD:1,CREATING_FIELD:2, CREATING_HOLE:3, REMOVING_HOLE:4, CREATING_ZONE:5, REMOVING_ZONE:6};
    var commandMode;
    var newFieldId=null;
    var containerDiv;
    var imageOpsBaseUrl;
    var builderController;
    var LayerTypes={BOUNDARY:0,SOIL:1,LANDSAT_NDVI:2,AERIAL:3,YIELD_IMAGE:4,MAX_LAYERS:5};
    var layers;
    var cachedSoilMapData="";
    
    //Oh the power of prototype :)
    Array.prototype.remove = function(object){
        for (var i = 0; i < this.length ; i++){
            if (object == this[i]){
                this.splice(i,1);
            }
        }
    };
    
    // *************************************************** LatLon
    function LatLon() // in degrees
    {
        var latitude;
        var longitude;
        
        this.init=function(lat,lon)
        {
            latitude=Math.round(lat*LatLon.PRECISION)/LatLon.PRECISION;
            longitude=Math.round(lon*LatLon.PRECISION)/LatLon.PRECISION;
        };
        
        this.getLatitude=function()
        {
            return latitude;
        };
        
        this.getLongitude=function()
        {
            return longitude;
        };
        
        this.getCesiumLatLon=function()
        {
            return Cesium.Cartographic.fromDegrees(longitude,latitude);        
        };
    }
    
    LatLon.fromDegrees=function(lat,lon)
    {
        var ll=new LatLon();
        ll.init(lat,lon);
        return ll;
    };
    
    LatLon.clone=function(other)
    {
        return LatLon.fromDegrees(other.getLatitude(),other.getLongitude());
    };
    
    LatLon.PRECISION=100000000; // Max degree precision 1/LatLon.PRECISION
    
    // *************************************************** end LatLon
    
    function StringTokenizer(tokenString,delim)
    {
        var tokens=tokenString.split(delim);
        var curTokenIdx=0;
        
        this.hasMoreTokens=function()
        {
            return curTokenIdx<tokens.length;
        };
        
        this.nextToken=function()
        {
            var retVal=null;
            if (curTokenIdx<tokens.length) {
                retVal=tokens[curTokenIdx];
                curTokenIdx++;
            }
            
            return retVal;
        };
    }
    
    // *************************************************** end StringTokenizer
    
    function GeoPolygon()
    {
        var llBoundary=new Array(); // Array of LatLon
        var adjacentPolys=null;
        
        this.initWithLocations=function(boundary) // ArrayList<LatLon> boundary
        {
            adjacentPolys=null;
            for (var i=0; i<boundary.length; i++)
                llBoundary.push(LatLon.clone(boundary[i]));
        };
        
        this.getCesiumPoints=function()
        {
            var coords=new Array();
            for (var i=0; i<llBoundary.length; i++) {
                var ll=llBoundary[i];
                coords.push(Cesium.Cartographic.fromDegrees(ll.getLongitude(),ll.getLatitude()));
            }
            
            return coords;
        };
        
        this.llEqual=function(l1,l2) // LatLon l1,LatLon l2
        {
            var precision=LatLon.PRECISION/10.0;
            var tolerance=1/precision;
            if (Math.abs(l1.getLatitude()-l2.getLatitude())<=tolerance)
                if (Math.abs(l1.getLongitude()-l2.getLongitude())<=tolerance)
                    return true;

            return false;
        };
        
        this.getLLBoundary=function()
        {
            return llBoundary;
        };

        this.polyEqual=function(otherPoly)
        {
            if (this === otherPoly)
                return true;

            if (otherPoly===undefined || otherPoly===null)
                return false;

            var otherLLBoundary=otherPoly.getLLBoundary();
            if (llBoundary.length!==otherLLBoundary.length)
                return false;

            for (var i=0; i<llBoundary.length; i++)
            {
                if (!this.llEqual(llBoundary[i],otherLLBoundary[i]))
                    return false;
            }

            return true;
        };
        
        this.toLatLonString=function()
        {
            var latLonString="";
            for (var i=0; i<llBoundary.length; i++)
            {
                var ll=llBoundary[i]; // LatLon instance
                if (latLonString!=="")
                    latLonString+=",";
                
                latLonString+=ll.getLatitude();
                latLonString+=",";
                latLonString+=ll.getLongitude();
            }

            return latLonString;
        };
        
        this.getBounds=function()
        {
            var bounds=new GeoBoundingBox();
            for (var i=0; i<llBoundary.length; i++)
                bounds.updateBoundsPoint(llBoundary[i].getLatitude(),llBoundary[i].getLongitude());
            
            return bounds;
        };
        
        this.pointLocation = function(p){
            if (!this.getBounds().containsPoint(p)){
                return GeoPolygon.RelativeLocation.Outside;
            }
        
            var x=p.getLongitude(); //double
            var y=p.getLatitude(); //double
            var pIdx; //int
            var crossings=0; //int
            var n=llBoundary.length; //int
            for (var i = 0; i < n; i++)
            {
                var pi=new GeoPoint(llBoundary[i]);

                if (i==(n-1))
                    pIdx=0;
                else
                    pIdx=i+1;

                var pi1=new GeoPoint(llBoundary[pIdx]);

                if ((pi.getX() < x && x < pi1.getX()) || (pi.getX() > x && x > pi1.getX()))
                {
                    var t = (x - pi1.getX()) / (pi.getX() - pi1.getX()); //double
                    var cy = t*pi.getY() + (1.0-t)*pi1.getY(); //double
                    if (y == cy){ 
                        return GeoPolygon.RelativeLocation.OnBoundary;
                    }
                    else if (y > cy){
                        crossings++;
                    }
                }
                if (pi.getX() == x && pi.getY() <= y)
                {
                    if (pi.getY() == y)
                        return GeoPolygon.RelativeLocation.OnBoundary;

                    if (pi1.getX() == x)
                    {
                        if ((pi.getY() <= y && y <= pi1.getY()) || (pi.getY() >= y && y >= pi1.getY()))
                            return GeoPolygon.RelativeLocation.OnBoundary;
                    } 
                    else if (pi1.getX() > x){
                        crossings++;
                    }

                    if (i==0)
                        pIdx=n-1;
                    else
                        pIdx=i-1;

                    var pim1=new GeoPoint(llBoundary[pIdx]);

                    if (pim1.getX() > x){
                        crossings++;
                    }
                }
            }
            if ((crossings % 2)==1){
                return GeoPolygon.RelativeLocation.Inside;
            }
            return GeoPolygon.RelativeLocation.Outside;
            
        };
    }
    
    //Other values not necessary, used as an example
    GeoPolygon.RelativeLocation = {  
            Inside : {value: 0, name: "inside", code: "IS"}, 
            Outside: {value: 1, name: "outside", code: "OS"}, 
            OnBoundary : {value: 2, name: "onboundary", code: "OB"}
    };
    
    GeoPolygon.fromLatLonString=function(latLonString)
    {
        var outlinePoints=new Array();
        var st=new StringTokenizer(latLonString,",");
        while (st.hasMoreTokens())
        {
            var lat=parseFloat(st.nextToken());
            var lng=parseFloat(st.nextToken());
            var l=LatLon.fromDegrees(lat,lng);
            outlinePoints.push(l);
        }
        var newPoly=new GeoPolygon();
        newPoly.initWithLocations(outlinePoints);
        return newPoly;
    };

    // *************************************************** end GeoPolygon
    
    function GeoPoint(p)
    {
        var x; //double
        var y; //double
        
        if(p instanceof LatLon){
           x=p.getLongitude(); 
           y=p.getLatitude();  
        }
        
        this.getX = function() 
        { 
            return x; 
        };
        
        this.getY = function() 
        { 
            return y; 
        };
    }
    
    function GeoBoundingBox()
    {
        var minLat=360;
        var minLng=360;
        var maxLat=-360;
        var maxLng=-360;
        var Projection = {
            Undefined : 0,
            GCS : 1,
            UTM : 2
        };
        
        var rectangularProjection;
        
        this.initWithMinMax=function(pMinLat,pMinLng,pMaxLat,pMaxLng)
        {
            rectangularProjection = Projection.GCS;
            minLat=pMinLat;
            minLng=pMinLng;
            maxLat=pMaxLat;
            maxLng=pMaxLng;
        };
        
        this.getMinLat=function()
        {
            return minLat;
        };

        this.getMinLng=function()
        {
            return minLng;
        };

        this.getMaxLat=function()
        {
            return maxLat;
        };

        this.getMaxLng=function()
        {
            return maxLng;
        };

        this.updateBoundsPoint=function(lat,lng) // double lat,double lng
        {
            rectangularProjection = Projection.GCS;
            minLat=Math.min(minLat,lat);
            minLng=Math.min(minLng,lng);
            maxLat=Math.max(maxLat,lat);
            maxLng=Math.max(maxLng,lng);
        };

        this.updateBoundsBox=function(bounds) // GeoBoundingBox bounds
        {
            this.updateBoundsPoint(bounds.getMaxLat(),bounds.getMinLng());
            this.updateBoundsPoint(bounds.getMinLat(),bounds.getMinLng());
            this.updateBoundsPoint(bounds.getMinLat(),bounds.getMaxLng());
            this.updateBoundsPoint(bounds.getMaxLat(),bounds.getMaxLng());
        };
        
        this.addMargin=function(margin)
        {
            minLat-=margin;
            maxLat+=margin;
            minLng-=margin;
            maxLng+=margin;
        };
        
        this.containsPoint = function(llPoint)
        {
            var lat = llPoint.getLatitude();
            var lng = llPoint.getLongitude();
            
//            if (rectangularProjection==Projection.Undefined)
//                throw new Exception("Invalid projection");

            if (rectangularProjection==Projection.GCS)
                return (minLng<=lng && lng<=maxLng && minLat<=lat && lat<=maxLat);

//            if (cachedBoundsPoly==null)
//                cachedBoundsPoly=GeoPolygon.fromLatLonArray(gcsCorners);
//
//            return cachedBoundsPoly.pointLocation(LatLon.fromDegrees(lat,lng))!=GeoPolygon.RelativeLocation.Outside;
        };
    }
    
    // *************************************************** end GeoBoundingBox
    
    // *************************************************** FieldContour
    function FieldContour()
    {
        var polygon;                    // GeoPolygon
        var locationsInitialized=false;
        var initialPolygon;             // GeoPolygon
        var holes;                      // ArrayList<FieldContour>
        var zones;                      // ArrayList<FieldContour>
        var parent;
        var contourId;
        var contourType;
        
        this.initWithParent=function(pParent,pContourType)
        {
            locationsInitialized=false;
            parent=pParent;
            holes=null;
            zones=null;
            contourType=pContourType;
            contourId=null;
        };
        
        this.setLocations=function(pLocations)
        {
            polygon=new GeoPolygon();
            polygon.initWithLocations(pLocations);
            if (!locationsInitialized)
            {
                initialPolygon=new GeoPolygon();
                initialPolygon.initWithLocations(pLocations);
                locationsInitialized=true;
            }
        };
        
        
        this.setContourId=function(pContourId)
        {
            contourId=pContourId;
        };
        
        this.isHole=function()
        {
            return contourType===FieldContour.ContourTypes.HOLE;
        };
        
        this.isZone=function()
        {
            return contourType===FieldContour.ContourTypes.ZONE;
        };
        
        this.hasHoles=function()
        {
            return holes!==undefined && holes!==null && holes.length>0;
        };
        
        this.hasZones=function()
        {
            return zones!==undefined && zones!==null && zones.length>0;
        };
        
        this.addHole=function(pLocations)
        {
            if (this.isHole())
                throw "Field boundaries may not have nested holes";

            var holeContour=new FieldContour();
            holeContour.initWithParent(this,FieldContour.ContourTypes.HOLE);
            holeContour.setLocations(pLocations);
            if (holes==null){
                holes=new Array();
            }
            
            holes.push(holeContour);

            return holeContour;
        };
        
        this.removeHole = function(hole){
            if (holes != null)
            {
                holes.remove(hole);
                if (holes.length < 1)
                {
                    holes=null;
                }
            }
        };
        
        this.addZone=function(pLocations)
        {
            if (this.isHole())
                throw "Field boundaries may not have nested zones";

            var zoneContour=new FieldContour();
            zoneContour.initWithParent(this,FieldContour.ContourTypes.ZONE);
            zoneContour.setLocations(pLocations);
            if (zones==null){
                zones=new Array();
            }
            
            zones.push(zoneContour);

            return zoneContour;
        };
        
        this.removeZone = function(zone){
            if (zones != null)
            {
                zones.remove(zone);
                if (zones.length < 1)
                {
                    zones=null;
                }
            }
        };
        
        this.getCesiumPoints=function()
        {
            var polys=new Array();
            polys.push(polygon.getCesiumPoints());
            
            if (this.hasHoles())
            {
                for (var i=0; i<holes.length; i++)
                    polys.push(holes[i].getCesiumPoints());
            }
            
            if (this.hasZones())
            {
                for (var i=0; i<zones.length; i++)
                    polys.push(zones[i].getCesiumPoints());
            }
            
            return polys;
        };
        
        this.isModified=function()
        {
            var modified=!polygon.polyEqual(initialPolygon);
            if (!modified && this.hasHoles())
            {
                for (var i=0; i<holes.length && !modified; i++)
                    modified=holes[i].isModified();
            }

            if (!modified && this.hasZones())
            {
                for (var i=0; i<zones.length && !modified; i++)
                    modified=zones[i].isModified();
            }

            return modified;
        };
        
        this.isOuterBoundary=function()
        {
            return parent===undefined || parent===null;
        };
        
        this.toLatLonString=function()
        {
            var latLonString="";
            if (polygon!==undefined && polygon!==null)
            {
                if (this.isOuterBoundary())
                    latLonString=FieldContour.OUTER_BOUNDARY_CODE+","+FieldContour.OUTER_BOUNDARY_CODE+",";
                else if (this.isHole())
                    latLonString=FieldContour.HOLE_CONTOUR_CODE+","+FieldContour.HOLE_CONTOUR_CODE+",";
                else if (this.isZone())
                    latLonString=FieldContour.ZONE_CONTOUR_CODE+","+FieldContour.ZONE_CONTOUR_CODE+",";

                if (contourId!==undefined && contourId!==null && contourId!=="")
                    latLonString+=FieldContour.ID_DATA_CODE+","+contourId+",";

                latLonString+=polygon.toLatLonString();
                if (this.hasHoles())
                {
                    for (var i=0; i<holes.length; i++)
                        latLonString+=","+holes[i].toLatLonString();
                }

                if (this.hasZones())
                {
                    for (var i=0; i<zones.length; i++)
                        latLonString+=","+zones[i].toLatLonString();
                }
            }
            return latLonString;
        };
        
        this.getPolygon=function()
        {
            return polygon;
        };
        
        this.getZones = function()
        {
            return zones;
        };
        
        this.getHoles = function()
        {
            return holes;
        };
        
        this.getParent = function()
        {
            return parent;
        };

    }
    
    FieldContour.OUTER_BOUNDARY_CODE="600";
    FieldContour.ZONE_CONTOUR_CODE="550";
    FieldContour.HOLE_CONTOUR_CODE="500";
    FieldContour.ID_DATA_CODE="400";
    FieldContour.OUTER_BOUNDARY_CODE_NUMERIC=600.0;
    FieldContour.ZONE_CONTOUR_CODE_NUMERIC=550.0;
    FieldContour.HOLE_CONTOUR_CODE_NUMERIC=500.0;
    FieldContour.ID_DATA_CODE_NUMERIC=400.0;
    FieldContour.ContourTypes = {OUTER:0,HOLE:1,ZONE:2};
    
    FieldContour.addPoly=function(contour,polyPts,polyType,newContourId)
    {
        if (polyPts.length===0)
            return;
        
        var newContour;
        switch (polyType)
        {
            case FieldContour.ContourTypes.OUTER:
                contour.setLocations(polyPts);
                contour.setContourId(newContourId);
                break;
            case FieldContour.ContourTypes.HOLE:
                newContour=contour.addHole(polyPts);
                newContour.setContourId(newContourId);
                break;
            case FieldContour.ContourTypes.ZONE:
                newContour=contour.addZone(polyPts);
                newContour.setContourId(newContourId);
                break;
        }
    };
    
    FieldContour.fromLatLonTokens=function(tokenizer)
    {
        var newContour=new FieldContour();
        var polyPts=new Array();
        var lat=tokenizer.nextToken();
        var lon=tokenizer.nextToken();
        if (lat===FieldContour.OUTER_BOUNDARY_CODE)
        {
            lat=tokenizer.nextToken();
            lon=tokenizer.nextToken();
        }            
        var curType=FieldContour.ContourTypes.OUTER;
        var parsedContour=false;
        var newContourId=null;
        while (!parsedContour)
        {
            if (lat===FieldContour.OUTER_BOUNDARY_CODE)
            {
               FieldContour.addPoly(newContour,polyPts,curType,newContourId);
                parsedContour=true;
            }
            else
            {
                if (lat===FieldContour.ID_DATA_CODE)
                    newContourId=lon;
                else if (lat===FieldContour.HOLE_CONTOUR_CODE)
                {
                    FieldContour.addPoly(newContour,polyPts,curType,newContourId);
                    newContourId=null;
                    polyPts.length = 0;
                    curType=FieldContour.ContourTypes.HOLE;
                }
                else if (lat===FieldContour.ZONE_CONTOUR_CODE)
                {
                    FieldContour.addPoly(newContour,polyPts,curType,newContourId);
                    newContourId=null;
                    polyPts.length = 0;
                    curType=FieldContour.ContourTypes.Zone;
                }            
                else
                    polyPts.push(LatLon.fromDegrees(parseFloat(lat),parseFloat(lon)));

                if (tokenizer.hasMoreTokens())
                {
                    lat=tokenizer.nextToken();
                    lon=tokenizer.nextToken();
                }
                else
                {
                    FieldContour.addPoly(newContour,polyPts,curType,newContourId);
                    parsedContour=true;
                }
            }
        }            
        
        return newContour;
    };
    
    FieldContour.fromLatLonArray=function(newContour,latLonArray,arrayPos) // FieldContour newContour,double[] latLonArray,int arrayPos
    {
        var polyPts=new Array();
        var lat=latLonArray[arrayPos];
        var lon=latLonArray[arrayPos+1];
        arrayPos+=2;
        if (lat>(FieldContour.OUTER_BOUNDARY_CODE_NUMERIC-1.0))
        {
            lat=latLonArray[arrayPos];
            lon=latLonArray[arrayPos+1];
            arrayPos+=2;
        }            
        var curType=FieldContour.ContourTypes.OUTER;
        var parsedContour=false;
        
        while (!parsedContour)
        {
            if (lat>(FieldContour.OUTER_BOUNDARY_CODE_NUMERIC-1.0))
            {
                FieldContour.addPoly(newContour,polyPts,curType,null);
                parsedContour=true;
            }
            else
            {
                if (lat>(FieldContour.ID_DATA_CODE_NUMERIC-1.0) && lat<(FieldContour.ID_DATA_CODE_NUMERIC+1.0))
                    throw "Contour id code not implemented";
                else if (lat>(FieldContour.ZONE_CONTOUR_CODE_NUMERIC-1.0))
                {
                    FieldContour.addPoly(newContour,polyPts,curType,null);
                    polyPts=new Array();
                    curType=FieldContour.ContourTypes.ZONE;
                }
                else if (lat>(FieldContour.HOLE_CONTOUR_CODE_NUMERIC-1.0))
                {
                    FieldContour.addPoly(newContour,polyPts,curType,null);
                    polyPts=new Array();
                    curType=FieldContour.ContourTypes.HOLE;
                }            
                else
                    polyPts.push(LatLon.fromDegrees(lat,lon));

                if (arrayPos<latLonArray.length)
                {
                    lat=latLonArray[arrayPos];
                    lon=latLonArray[arrayPos+1];
                    arrayPos+=2;
                }
                else
                {
                    FieldContour.addPoly(newContour,polyPts,curType,null);
                    parsedContour=true;
                }
            }
        }            
        
        return arrayPos;
    };
    
    // *************************************************** end FieldContour
    
    // *************************************************** FieldBoundary
    function FieldBoundary()
    {
        var outerBoundaries=new Array(); // ArrayList<FieldContour>
        var selected=false;
        var fipsCode;
        var fieldId=null;
        
        this.addContour=function(contour)
        {
            outerBoundaries.push(contour);
        };
        
        this.setId=function(id)
        {
            fieldId=id;
        };
        
        this.getId=function()
        {
            return fieldId;
        };
        
        this.getOuterBoundaries=function()
        {
            return outerBoundaries;
        };
        
        this.getFipsCode=function()
        {
            return fipsCode;
        };
        
        this.setFipsCode=function(value)
        {
            fipsCode=value;
        };
        
        this.setSelected=function(newValue)
        {
            selected=newValue;
        };
        
        this.isSelected=function()
        {
            return selected;
        };
        
        this.getCesiumPoints=function()
        {
            var polys=new Array();
            for (var i=0; i<outerBoundaries.length; i++)
            {
                var contour=outerBoundaries[i];
                polys=polys.concat(contour.getCesiumPoints());
            }
            
            return polys;
        };
        
        this.isModified=function()
        {
            var modified=false;
            for (var i=0; i<outerBoundaries.length && !modified; i++)
                modified=outerBoundaries[i].isModified();

            return modified;
        };

        this.toLatLonString=function()
        {
            var latLonString="";
            for (var i=0; i<outerBoundaries.length; i++)
            {
                if (latLonString!=="")
                    latLonString+=",";

                latLonString+=outerBoundaries[i].toLatLonString();
            }
            
            return latLonString;
        };
        
        this.getSurfacePolygons=function(gisView,attrs,zoneAttrs) 
        {
            var surfacePolys=new Array();
            for (var i=0; i<outerBoundaries.length; i++)
            {
                var fc=outerBoundaries[i];
                var sp;
                if (fc.hasZones())
                {
                    var zones=fc.getZones();
                    for (var j=0; j<zones.length; j++)
                    {
                        var z=zones[j];
                        sp=gisView.createSurfacePolygon(z.getPolygon().getCesiumPoints(),zoneAttrs);
                        surfacePolys.push(sp);
                    }
                }
                if (fc.hasHoles())
                {
                    var holes=fc.getHoles();
                    for (var j=0; j<holes.length; j++)
                    {
                        var h=holes[j];
                        sp=gisView.createSurfacePolygon(h.getPolygon().getCesiumPoints(),attrs);
                        surfacePolys.push(sp);
                    }
                }
                sp=gisView.createSurfacePolygon(fc.getPolygon().getCesiumPoints(),attrs);
                surfacePolys.push(sp);
            }
            return surfacePolys;
        };
        
        this.boundaryIsModified = function()
        {
            for (var i=0; i<outerBoundaries.length; i++)
            {
                var fc=outerBoundaries[i];
                if (fc.isModified)
                {
                    return true;
                }
            }
            return false;
        };
        
        this.getBoundingBox=function()
        {
            var bounds=new GeoBoundingBox();
            for (var i=0; i<outerBoundaries.length; i++)
                bounds.updateBoundsBox(outerBoundaries[i].getPolygon().getBounds());
            
            return bounds;
        };
    }
    
    FieldBoundary.fromLatLonString=function(boundaryString)
    {
        var boundary=new FieldBoundary();
        var st=new StringTokenizer(boundaryString,",");
        while (st.hasMoreTokens())
            boundary.addContour(FieldContour.fromLatLonTokens(st));
        
        return boundary;
    };
    
    FieldBoundary.fromLatLonArrayList=function(latLonList) // ArrayList<LatLon> latLonList
    {
        var points=new Array();
        for (var i=0; i<latLonList.length; i++)
        {
            points.push(latLonList[i].getLatitude());
            points.push(latLonList[i].getLongitude());
        }
        
        return FieldBoundary.fromLatLonArray(points);
    };
    
    FieldBoundary.fromLatLonArray=function(latLonArray) // double[] latLonArray
    {
        var boundary=new FieldBoundary();
        var arrayPos=0;
        while (arrayPos<latLonArray.length)
        {
            var newContour=new FieldContour();
            arrayPos=FieldContour.fromLatLonArray(newContour,latLonArray,arrayPos);
            boundary.addContour(newContour);
        }
        return boundary;
    };
    
    // *************************************************** end FieldBoundary
    
    function FieldContourEditorController()
    {
        var builderController;
        var editors=new Array();
        var editingBoundary=null;
        var EditModes={NONE:0,ADD_CONTROL_POINT:1,DELETE_CONTROL_POINT:2,ADD_HOLE:3,REMOVE_HOLE:4,MERGE_FIELDS:5,ADD_ZONE:6,REMOVE_ZONE:7};
        var editMode;
        var gisView;
        var editHandler;
        
        this.init=function(args)
        {
            builderController=args.builderController;
            gisView = args.gisView;
            editMode=EditModes.NONE;
        };
        
        this.isEditing=function()
        {
            return editors.length>0;
        };
        
        this.stopEditing=function()
        {
            if (this.isEditing())
            {
                for (var i = 0; i < editors.length; i++){
                    editors[i].stopEditing();
                }

                editHandler.destroy();
                editors=new Array();
                editingBoundary=null;
            }
        };
        
        this.stopEditingArea = function(contour)
        {
            if (this.isEditing()){
                for (var i = 0; i < editors.length; i++){
                    if (editors[i].getContour() == contour){
                        editors[i].stopEditing();
                        editors.remove(editors[i]);
                    }
                }
            }
        };
        
        this.selectedFieldChanged=function(selectedField)
        {
//            if (selectedField!==null)
//                editTools.enableTool(ToolsLayer.ToolControl.EDIT_FIELD_BOUNDARY);
//            else
//                editTools.disableTool(ToolsLayer.ToolControl.EDIT_FIELD_BOUNDARY);
        };
        
        this.startEditing=function(boundary)
        {
            editors=new Array();
            editHandler = new EditHandlers(gisView.getWidget().scene);
            
            for (var i = 0 ; i < boundary.getOuterBoundaries().length; i++)
            {
                
                var bound = boundary.getOuterBoundaries()[i];
                
                if (bound.hasHoles()){
                    var holes = bound.getHoles();
                    for (var j = 0; j < holes.length; j++){
                        var editor = new FieldContourEditor({
                           gisView : gisView,
                           contour: holes[j],
                           handler: editHandler
                        });
                        editors.push(editor);
                    }
                }
                
                if (bound.hasZones()){
                    var zones = bound.getZones();
                    for (var k = 0; k < zones.length; k++){
                        var editor = new FieldContourEditor({
                           gisView : gisView,
                           contour: zones[k],
                           handler: editHandler
                        });
                        editors.push(editor);
                    }
                }
                var editor = new FieldContourEditor({
                    gisView : gisView,
                    contour : bound,
                    handler : editHandler
                });
                editors.push(editor);
            }
        };
        
        this.addZone = function(point){
            var wasEditing = this.isEditing();
            try{
                var lat = Cesium.Math.toDegrees(point.latitude);
                var lon = Cesium.Math.toDegrees(point.longitude);
                var ll = new LatLon.fromDegrees(lat, lon);
                
                var boundary = builderController.getSelectedBoundary();
                
                if (ll === null || boundary === null)
                    return;
                
                if (!wasEditing){
                    this.startEditing(boundary);
                }

                var outerContour = this.findContourForPoint(ll, FieldContour.ContourTypes.ZONE);
                
                if (outerContour!=null)
                {
                    var zoneDim=0.000135; // degree offset for around 250 meters
                    var zonePoints=new Array();
                    var lat=Cesium.Math.toDegrees(point.latitude);
                    var lon=Cesium.Math.toDegrees(point.longitude);
                    zonePoints.push(LatLon.fromDegrees(lat+zoneDim,lon-zoneDim));
                    zonePoints.push(LatLon.fromDegrees(lat-zoneDim,lon-zoneDim));
                    zonePoints.push(LatLon.fromDegrees(lat-zoneDim,lon+zoneDim));
                    zonePoints.push(LatLon.fromDegrees(lat+zoneDim,lon+zoneDim));
                    //ArrayList<LatLon> holePts=createPolygon(llMousePoint,0.000135); // 0.000135 = degree offset for around 15 meters

                    var zone = outerContour.addZone(zonePoints);
                    var editor = new FieldContourEditor({
                           gisView : gisView,
                           contour: zone,
                           handler: editHandler
                        });
                    editors.push(editor);
                    gisView.getFieldBoundaryLayer().updateSelectedBoundary();
                }
                
                if (!wasEditing){
                    this.stopEditing();
                }
            }catch(err){
                
            }
        };
        
        this.removeZone = function(point){
            var wasEditing = this.isEditing();
            try
            {
                var lat = Cesium.Math.toDegrees(point.latitude);
                var lon = Cesium.Math.toDegrees(point.longitude);
                var ll = new LatLon.fromDegrees(lat, lon);
                
                var boundary = builderController.getSelectedBoundary();
                
                if (ll === null || boundary === null)
                    return;
                
                if (!wasEditing){
                    this.startEditing(boundary);
                }
                
                var outerContour = this.findContourForPoint(ll); //null for second param
                var area = this.findAreaForPoint(ll, FieldContour.ContourTypes.ZONE);
                
                if (area != null && outerContour != null){
                    this.stopEditingArea(area);
                    outerContour.removeZone(area);
                    gisView.getFieldBoundaryLayer().updateSelectedBoundary();
                }
                
                if(!wasEditing){
                    this.stopEditing();
                }
                
            } catch(err){
                
            }
        };
        
        this.addHole = function(point){
            var wasEditing = this.isEditing();
            try{
                var lat = Cesium.Math.toDegrees(point.latitude);
                var lon = Cesium.Math.toDegrees(point.longitude);
                var ll = new LatLon.fromDegrees(lat, lon);
            
                var boundary = builderController.getSelectedBoundary();
                
                if (ll === null || boundary === null)
                    return;
                
                if (!wasEditing){
                    this.startEditing(boundary);
                }

                var outerContour = this.findContourForPoint(ll, FieldContour.ContourTypes.HOLE);
                
                if (outerContour!=null)
                {
                    var holeDim=0.000135; // degree offset for around 250 meters
                    var holePoints=new Array();
                    var lat=Cesium.Math.toDegrees(point.latitude);
                    var lon=Cesium.Math.toDegrees(point.longitude);
                    holePoints.push(LatLon.fromDegrees(lat+holeDim,lon-holeDim));
                    holePoints.push(LatLon.fromDegrees(lat-holeDim,lon-holeDim));
                    holePoints.push(LatLon.fromDegrees(lat-holeDim,lon+holeDim));
                    holePoints.push(LatLon.fromDegrees(lat+holeDim,lon+holeDim));
                    //ArrayList<LatLon> holePts=createPolygon(llMousePoint,0.000135); // 0.000135 = degree offset for around 15 meters

                    var hole = outerContour.addHole(holePoints);
                    var editor = new FieldContourEditor({
                           gisView : gisView,
                           contour: hole,
                           handler: editHandler
                        });
                    editors.push(editor);
                    gisView.getFieldBoundaryLayer().updateSelectedBoundary();
                }
                
                if (!wasEditing){
                    this.stopEditing();
                }
            }catch(err){
                
            }
        };
        
        this.removeHole = function(point){
            var wasEditing = this.isEditing();
            try
            {
                var lat = Cesium.Math.toDegrees(point.latitude);
                var lon = Cesium.Math.toDegrees(point.longitude);
                var ll = new LatLon.fromDegrees(lat, lon);
                
                var boundary = builderController.getSelectedBoundary();
                
                if (ll === null || boundary === null)
                    return;
                
                if (!wasEditing){
                    this.startEditing(boundary);
                }
                
                var outerContour = this.findContourForPoint(ll); //null for second param
                var area = this.findAreaForPoint(ll, FieldContour.ContourTypes.HOLE);
                
                if (area != null && outerContour != null){
                    this.stopEditingArea(area);
                    outerContour.removeHole(area);
                    gisView.getFieldBoundaryLayer().updateSelectedBoundary();
                }
                if(!wasEditing){
                    this.stopEditing();
                }
   
            } catch(err){
                
            }
        };
        
        this.findAreaForPoint = function(llPoint, type){
            var area = null;
            for (var i = 0; i < editors.length; i++)
            {
                var fc = editors[i].getContour();
                if ((type === FieldContour.ContourTypes.HOLE) && fc.isHole()){
                    if  (fc.getPolygon().pointLocation(llPoint) != GeoPolygon.RelativeLocation.Outside){
                        area = fc;
                    }
                }
                else if ((type === FieldContour.ContourTypes.ZONE) && fc.isZone())
                {
                    if  (fc.getPolygon().pointLocation(llPoint) != GeoPolygon.RelativeLocation.Outside){
                        area = fc;
                    }
                }
            }
            
            return area;
            
        };
        
        this.findContourForPoint = function(llPoint, type)
        {   
            var validPoint=true;  //Boolean
            var outerContour=null; //FieldContour
            for (var i=0; i<editors.length && validPoint; i++)
            {
                var fc=editors[i].getContour();
                if ((type === FieldContour.ContourTypes.HOLE) && fc.isHole())
                {
                    if  (fc.getPolygon().pointLocation(llPoint)!= GeoPolygon.RelativeLocation.Outside){
                        validPoint=false;
                    }
                } 
                else if ((type === FieldContour.ContourTypes.ZONE) && fc.isZone()){
                    if  (fc.getPolygon().pointLocation(llPoint)!= GeoPolygon.RelativeLocation.Outside){
                        validPoint=false;
                    }
                }
                else if (fc.isOuterBoundary() && (fc.getPolygon().pointLocation(llPoint)===GeoPolygon.RelativeLocation.Inside)){
                    outerContour=fc;
                }
            }
            
            if (!validPoint)
                outerContour=null;

            return outerContour;
        };
    }
    
    // *************************************************** end FieldContourEditorController
    
    function FieldBoundaryBuilderController()
    {
        var fieldBoundaryEntries=new Array();   // ArrayList<FieldBoundary>
        var selectedBoundary=null;              
        var editorController;                   // FieldContourEditorController
        var gisView;
        //var isEditing = false;
        
        this.init=function(view)
        {
            gisView=view;
            editorController=new FieldContourEditorController();
            editorController.init({
                    gisView : view,
                    builderController: this
            });
        };
        
        
        this.getBoundaries=function()
        {
            return fieldBoundaryEntries;
        };
        
        this.addBoundary=function(boundary)
        {
            fieldBoundaryEntries.push(boundary);
            gisView.getFieldBoundaryLayer().addBoundary(boundary);
            //appView.getWwd().redraw();
        };
    
        this.createNewEntry=function(boundary)
        {
            this.addBoundary(boundary);
            this.selectBoundary(boundary);
        };
        
        this.createBoundaryAtPoint=function(point) // Cartographic point;
        {
            var holeDim=0.00226; // degree offset for around 250 meters
            var boundaryPoints=new Array();
            var lat=Cesium.Math.toDegrees(point.latitude);
            var lon=Cesium.Math.toDegrees(point.longitude);
            boundaryPoints.push(LatLon.fromDegrees(lat+holeDim,lon-holeDim));
            boundaryPoints.push(LatLon.fromDegrees(lat-holeDim,lon-holeDim));
            boundaryPoints.push(LatLon.fromDegrees(lat-holeDim,lon+holeDim));
            boundaryPoints.push(LatLon.fromDegrees(lat+holeDim,lon+holeDim));

            var newBoundary=FieldBoundary.fromLatLonArrayList(boundaryPoints);
            this.addBoundary(newBoundary);
            this.selectBoundary(newBoundary);

            return newBoundary;
        };
    
        this.selectBoundary=function(newSelection)
        {
            if (newSelection!==selectedBoundary)
            {
                if (selectedBoundary!==null)
                {
                    selectedBoundary.setSelected(false);
                    editorController.stopEditing();
                    gisView.getFieldBoundaryLayer().resetBoundary(selectedBoundary);
                }

                if (newSelection!==null)
                    newSelection.setSelected(true);
                
                selectedBoundary=newSelection;

                gisView.selectedFieldChanged();
                editorController.selectedFieldChanged(selectedBoundary);
                gisView.getFieldBoundaryLayer().resetBoundary(selectedBoundary);
            }
        };
        
        this.toggleEditSelectedBoundary=function()
        {
            if (editorController.isEditing())
            {
                this.setSelectionEditing(false);
                
            } else
            {
                this.setSelectionEditing(true);
            }
 
        };
        

        this.getSelectedBoundary=function()
        {
            return selectedBoundary;
        };
        
        this.findBoundary=function(fieldBoundaryId) // String fieldBoundaryId
        {
            for (var i=0; i<fieldBoundaryEntries.length; i++)
                if (fieldBoundaryEntries[i].getId()===fieldBoundaryId)
                    return fieldBoundaryEntries[i];

            return null;
        };
        
        this.isSelectionEditing=function()
        {
            return editorController.isEditing();
        };
        
        this.setSelectionEditing=function(edit) // boolean edit
        {
            if (selectedBoundary!==undefined && selectedBoundary!==null)
            {
                if (edit)
                {
                    if (!editorController.isEditing())
                        editorController.startEditing(selectedBoundary);
                }
                else
                    editorController.stopEditing();
            }
        };
        
        this.removeBoundary=function(boundary) // FieldBoundary boundary
        {
            if (selectedBoundary===boundary)
                this.selectBoundary(null);

            var boundaryIdx=fieldBoundaryEntries.indexOf(boundary);
            if (boundaryIdx>=0)
                fieldBoundaryEntries.splice(boundaryIdx,1);
            
            gisView.getFieldBoundaryLayer().removeBoundary(boundary);
        };

        this.removeAllBoundaries=function()
        {
            while (fieldBoundaryEntries.length>0)
            {
                this.removeBoundary(fieldBoundaryEntries[0]);
            }
        };
        
        this.findBoundary=function(fieldBoundaryId)
        {
            for (var i=0; i<fieldBoundaryEntries.length; i++) {
                if (fieldBoundaryEntries[i].getId()===fieldBoundaryId)
                    return fieldBoundaryEntries[i];
            }

            return null;
        };
        
        this.getBoundingBox=function()
        {
            if (fieldBoundaryEntries.length===0)
                return null;

            var fieldBounds=new GeoBoundingBox();
            for (var i=0; i<fieldBoundaryEntries.length; i++)
                fieldBounds.updateBoundsBox(fieldBoundaryEntries[i].getBoundingBox());

            return fieldBounds;
        };
        
        this.getEditorController = function(){
            return editorController;
        };

    }
    
    // *************************************************** end FieldBoundaryBuilderController
 
    function HashMap()
    {
        var keys=new Array();
        var values=new Array();
        
        this.put=function(key,value)
        {
            var keyIdx=keys.indexOf(key);
            if (keyIdx>=0)
                values[keyIdx]=value;
            else {
                keys.push(key);
                values.push(value);
            }
        };
        
        this.getKey=function(idx)
        {
            return keys[idx];
        };
        
        this.getAllKeys = function(){
            return keys;
        };
        
        this.getAllValues = function(){
            return values;
        };
        
        this.getValue=function(idx)
        {
            return values[idx];
        };
        
        this.containsKey=function(key)
        {
            return keys.indexOf(key)>=0;
        };
        
        this.get=function(key)
        {
            var keyIdx=keys.indexOf(key);
            if (keyIdx>=0)
                return values[keyIdx];
            
            return null;
        };
        
        this.remove=function(key)
        {
            var keyIdx=keys.indexOf(key);
            if (keyIdx>=0) {
                keys.splice(keyIdx,1);
                values.splice(keyIdx,1);
            }
        };
        
        this.length=function()
        {
            return keys.length;
        };
        
        this.sortByValue=function()
        {
            var swapped;
            do {
                swapped = false;
                for (var i=0; i < values.length-1; i++) {
                    if (values[i] < values[i+1]) {
                        var temp = values[i];
                        values[i] = values[i+1];
                        values[i+1] = temp;
                        temp = keys[i];
                        keys[i] = keys[i+1];
                        keys[i+1] = temp;
                        swapped = true;
                    }
                }
            } while (swapped);
        };
    }
    
    // *************************************************** end HashMap
    
    function FieldBoundaryLayer()
    {
        var normalAttrs;
        var selectedAttrs;
        var selectedZoneAttrs;
        var gisView;
        var boundaryPolys; // HashMap<FieldBoundary,ArrayList<SurfacePolygon>> 
        
        this.init=function(viewer)
        {
            gisView=viewer;
            boundaryPolys=new HashMap();
            normalAttrs=Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.BLACK);
            selectedAttrs=Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromBytes(192,0,0,255));
            selectedZoneAttrs=Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromBytes(255,160,0,255));
        };
        
        this.addBoundary=function(boundary) // FieldBoundary boundary
        {
            var attrs=normalAttrs;
            var zoneAttrs=normalAttrs;

            if (boundary.isSelected())
            {
                attrs=selectedAttrs;
                zoneAttrs=selectedZoneAttrs;
            }    

            var surfacePolys=boundary.getSurfacePolygons(gisView,attrs,zoneAttrs);
            boundaryPolys.put(boundary,surfacePolys);
            this.addRenderables(surfacePolys);
        };
        
        this.updateModifiedBoundaries = function()
        {
            var keys = boundaryPolys.getAllKeys();
            
            for(var i = 0; i < keys.length; i++){
                var boundary = keys[i];
                
                if (boundary.isModified()){
                    var attrs=normalAttrs;
                    var zoneAttrs=normalAttrs;

                    if (boundary.isSelected())
                    {
                        attrs=selectedAttrs;
                        zoneAttrs=selectedZoneAttrs;
                    }
                    this.removeBoundary(boundary);
                    var surfacePolys = boundary.getSurfacePolygons(gisView, attrs, zoneAttrs);
                    boundaryPolys.put(boundary, surfacePolys);
                    this.addBoundary(boundary);
                }
            }
            
        };
        
        this.updateSelectedBoundary = function(){
            var keys = boundaryPolys.getAllKeys();
            
            for(var i = 0; i < keys.length; i++){
                var boundary = keys[i];
                
                if (boundary.isSelected()){
                    attrs=selectedAttrs;
                    zoneAttrs=selectedZoneAttrs;
                    this.removeBoundary(boundary);
                    var surfacePolys = boundary.getSurfacePolygons(gisView, attrs, zoneAttrs);
                    boundaryPolys.put(boundary, surfacePolys);
                    this.addBoundary(boundary);
                }
            }
        };
        
        this.addRenderables=function(renderables) // ArrayList<primitives> renderables
        {
            var primitives=gisView.getWidget().scene.getPrimitives();
            for (var i=0; i<renderables.length; i++)
                primitives.add(renderables[i]);
        };
        
        this.removeRenderable=function(renderable)
        {
            var primitives=gisView.getWidget().scene.getPrimitives();
            primitives.remove(renderable);
        };
        
        this.removeRenderables=function(renderables) // ArrayList<primitives> renderables
        {
            var primitives=gisView.getWidget().scene.getPrimitives();
            for (var i=0; i<renderables.length; i++)
                primitives.remove(renderables[i]);
        };
        
        this.removeBoundary=function(boundary) // FieldBoundary boundary
        {
            
            if (boundaryPolys.containsKey(boundary))
            {
                var surfacePolys=boundaryPolys.get(boundary);
                for (var i=0; i<surfacePolys.length; i++) //for (SurfacePolygon sp:surfacePolys)
                    this.removeRenderable(surfacePolys[i]);

                boundaryPolys.remove(boundary);
            }
        };

        this.resetBoundary=function(boundary) // FieldBoundary boundary
        {
            if (boundary!==undefined && boundary!==null)
            {
                this.removeBoundary(boundary);
                this.addBoundary(boundary);
            }
        };
        
        this.getSelectedAttrs=function()
        {
            return selectedAttrs;
        };
       
        this.moveToTop=function()
        {
            var primitives=gisView.getWidget().scene.getPrimitives();
            for (var i=0; i<boundaryPolys.length(); i++) {
                var surfacePolys=boundaryPolys.getValue(i);
                
                for (var j=0; j<surfacePolys.length; j++) 
                    primitives.raiseToTop(surfacePolys[i]);
            }
        };
    }
    
    // *************************************************** end FieldBoundaryLayer
    
    function PrimitiveLayer()
    {
        var gisView;
        var gisPrimitives; // ArrayList<Primitive>
        
        this.init=function(viewer)
        {
            gisView=viewer;
            gisPrimitives=new Array();
        };
        
        this.addRenderable=function(renderable) // Primitive renderable
        {
            var cesiumPrimitives=gisView.getWidget().scene.getPrimitives();
            cesiumPrimitives.add(renderable);
            gisPrimitives.push(renderable);
        };
        
        this.addRenderables=function(renderables) // ArrayList<primitives> renderables
        {
            var cesiumPrimitives=gisView.getWidget().scene.getPrimitives();
            for (var i=0; i<renderables.length; i++) {
                gisPrimitives.push(renderables[i]);
                cesiumPrimitives.add(renderables[i]);
            }
        };
        
        this.removeRenderable=function(renderable)
        {
            var cesiumPrimitives=gisView.getWidget().scene.getPrimitives();
            cesiumPrimitives.remove(renderable);
            var rIdx=gisPrimitives.indexOf(renderable);
            if (rIdx>=0)
                gisPrimitives.splice(rIdx,1);
        };
        
        this.removeAllRenderables=function()
        {
            while (gisPrimitives.length>0)
                this.removeRenderable(gisPrimitives[0]);
        };
        
        this.moveToTop=function()
        {
            var cesiumPrimitives=gisView.getWidget().scene.getPrimitives();
            for (var i=0; i<gisPrimitives.length; i++)
                cesiumPrimitives.raiseToTop(gisPrimitives[i]);
        };
    };
    
    // *************************************************** end PrimitiveLayer
    
    // *************************************************** WingScanGis
    this.init = function(pCallBackObject)
    {
        commandMode=CommandModes.NONE;
        callBackObject=pCallBackObject;
        var containerDivName=callBackObject.getContainerDivName();
        viewerPath=callBackObject.getViewerPath();
        imageOpsBaseUrl=callBackObject.getImageOpsBaseUrl();
        baseTileProvider=new Cesium.SingleTileImageryProvider({ url : viewerPath+'/images/BMNG_world.topo.bathy.200405.3.2048x1024.jpg' });
        widget = new Cesium.CesiumWidget(containerDivName, { imageryProvider: baseTileProvider });
        var that=this;
        loadTimer=setInterval(function() { that.baseTileLoadCheck(); },1000);
        containerDiv=document.getElementById(containerDivName);
        var handler = new Cesium.ScreenSpaceEventHandler(widget.scene.getCanvas());
        handler.setInputAction(function (mouseInfo) { that.mouseClick(mouseInfo); },Cesium.ScreenSpaceEventType.LEFT_CLICK);
        builderController=new FieldBoundaryBuilderController();
        builderController.init(this);
        layers=new Array();
        for (var i=0; i<LayerTypes.MAX_LAYERS; i++)
            layers.push(null);
        
        layers[LayerTypes.BOUNDARY]=new FieldBoundaryLayer();
        layers[LayerTypes.BOUNDARY].init(this);
        layers[LayerTypes.SOIL]=new PrimitiveLayer();
        layers[LayerTypes.SOIL].init(this);
        layers[LayerTypes.LANDSAT_NDVI]=new PrimitiveLayer();
        layers[LayerTypes.LANDSAT_NDVI].init(this);
        layers[LayerTypes.YIELD_IMAGE]=new PrimitiveLayer();
        layers[LayerTypes.YIELD_IMAGE].init(this);
    };
    
    this.mouseClick=function(mouseInfo)
    {
        var ellipsoid = widget.scene.getPrimitives().getCentralBody().getEllipsoid();
        var cartesian = widget.scene.getCamera().controller.pickEllipsoid(mouseInfo.position,ellipsoid);
        var consumed=false;
        if (cartesian!==undefined)
        {
            var pos=ellipsoid.cartesianToCartographic(cartesian); // Cartographic pos;
            if (commandMode===CommandModes.FINDING_FIELD) {
                this.findField(pos);
                commandMode=CommandModes.NONE;
            }
            else if (commandMode===CommandModes.CREATING_FIELD) {
                this.createField(pos);
                commandMode=CommandModes.NONE;
            } 
            else if (commandMode===CommandModes.CREATING_HOLE) {
                this.createHole(pos);
                commandMode=CommandModes.NONE;
            }
            else if (commandMode===CommandModes.REMOVING_HOLE) {
                this.removeHole(pos);
                commandMode=CommandModes.NONE;
            }
            else if (commandMode===CommandModes.CREATING_ZONE){
                this.createZone(pos);
                commandMode=CommandModes.NONE;
            }
            else if (commandMode===CommandModes.REMOVING_ZONE) {
                this.removeZone(pos);
                
            }
        }
        else {
            commandMode=CommandModes.NONE;
            this.setDefaultCursor();
        }
        
        if (!consumed) {
            callBackObject.mouseClick(mouseInfo);
        }
    };
    
    this.baseTileLoadCheck=function()
    {
        if (baseTileProvider.isReady()) {
            this.loadBaseLayers();
            clearInterval(loadTimer);
        }
    };
    
    this.loadBaseLayers=function()
    {
         var layers = widget.centralBody.getImageryLayers();
         
        layers.addImageryProvider(
                    new Cesium.WebMapServiceImageryProvider({
                url: callBackObject.getLandsatWmsUrl(),
                parameters: {
                    transparent: 'false',
                    format: 'image/jpeg',
                    width: 512,
                    height: 512,
                    version: '1.3'
                },
                //proxy: new Cesium.DefaultProxy('/proxy/'),
                layers: 'esat'
            })
                );
                
        layers.addImageryProvider(
                new Cesium.WebMapServiceImageryProvider({
            url: callBackObject.getMapServerBaseUrl()+'/cgi-bin/mapserv.exe?MAP=m:/naip2010/mn/mn.map',
            extent : new Cesium.Extent(
                    Cesium.Math.toRadians(-97.274),
                    Cesium.Math.toRadians(43.420),
                    Cesium.Math.toRadians(-89.415),
                    Cesium.Math.toRadians(49.453)),
            parameters: {
                transparent: 'false',
                format: 'image/jpeg',
                width: 512,
                height: 512
            },
            //proxy: new Cesium.DefaultProxy('/proxy/'),
            layers: 'mn_2010_naip_group'
        })
                );
    };
    
    this.getWidget=function()
    {
        return widget;
    };
    
    this.setEyePos=function(lat,lon,altitude)
    {
        var controller = widget.scene.getCamera().controller;
        var pos=Cesium.Cartographic.fromDegrees(lon,lat,altitude);
        controller.setPositionCartographic(pos);
    };
    
    this.setCrossHairCursor=function()
    {
        containerDiv.style.cursor='crosshair';
    };
    
    this.setWaitCursor=function()
    {
        containerDiv.style.cursor='wait';
    };
    
    this.setDefaultCursor=function()
    {
        containerDiv.style.cursor='default';
    };
    
    this.enterCreateFieldMode=function(pNewFieldId)
    {
        newFieldId=pNewFieldId;
        if (newFieldId===undefined || (newFieldId!==null && newFieldId===""))
            newFieldId=null;
        
        commandMode=CommandModes.CREATING_FIELD;
        this.setCrossHairCursor();
    };
    
    this.enterFindFieldMode=function(pNewFieldId)
    {
        newFieldId=pNewFieldId;
        if (newFieldId===undefined || (newFieldId!==null && newFieldId===""))
            newFieldId=null;

        commandMode=CommandModes.FINDING_FIELD;
        this.setCrossHairCursor();
    };
    
    this.toggleCreateHoleMode = function()
    {
        if(commandMode===CommandModes.CREATING_HOLE)
        {
            commandMode = CommandModes.NONE;
            this.setDefaultCursor();
        } else {
            commandMode = CommandModes.CREATING_HOLE;
            this.setCrossHairCursor();
        }
        
    };
    
    this.toggleRemoveHoleMode = function()
    {
        if(commandMode===CommandModes.REMOVING_HOLE)
        {
            commandMode = CommandModes.NONE;
            this.setDefaultCursor();
        } else {
            commandMode = CommandModes.REMOVING_HOLE;
            this.setCrossHairCursor();
        }
        
    };
    
    this.toggleCreateZoneMode = function()
    {
        if(commandMode===CommandModes.CREATING_ZONE)
        {
            commandMode = CommandModes.NONE;
            this.setDefaultCursor();
        } else {
            commandMode = CommandModes.CREATING_ZONE;
            this.setCrossHairCursor();
        }
        
    };
    
    this.toggleRemoveZoneMode = function()
    {
        if(commandMode===CommandModes.CREATING_ZONE)
        {
            commandMode = CommandModes.NONE;
            this.setDefaultCursor();
        } else {
            commandMode = CommandModes.REMOVING_ZONE;
            this.setCrossHairCursor();
        }
        
    };
    
    this.findFieldRequestComplete=function(boundaryString)
    {
        if (boundaryString!==null && boundaryString!=="")
        {
            var boundary=FieldBoundary.fromLatLonString(boundaryString);
            if (newFieldId !== null)
                boundary.setId(newFieldId);

            builderController.createNewEntry(boundary);
            //displayFieldName(true);
            callBackObject.notifyFieldUpdated();
        }
        this.setDefaultCursor();
    };
    
    this.getImageOpsUrl=function(params)
    {
        var imageOpsUrl=imageOpsBaseUrl+params;
        //var proxy=new Cesium.DefaultProxy('/proxy/');
        // return proxy.getURL(imageOpsUrl);
        return imageOpsUrl;
    };
    
    this.findField=function(fieldPosition)
    {
        this.setWaitCursor();
        var that=this;
        var request = new XMLHttpRequest();
        var lat=Cesium.Math.toDegrees(fieldPosition.latitude);
        var lon=Cesium.Math.toDegrees(fieldPosition.longitude);
        var imageOpsUrl=this.getImageOpsUrl("/ImageOps/imageop?operation=findfield&latitude="+lat+"&longitude="+lon);
        request.onreadystatechange = function() { 
            if (request.readyState === 4 && request.status===200) {
                that.findFieldRequestComplete(request.responseText);
            } 
            else if (request.readyState === 4 && request.status!=200)
            {
                callBackObject.notifyError(request.statusText);
                that.setDefaultCursor();
            }
        };

        request.open('GET', imageOpsUrl, true);
        request.send(null);
    };
    
    this.createField=function(fieldPosition)
    {
        this.setWaitCursor();
        var newBoundary=builderController.createBoundaryAtPoint(fieldPosition);
        if (newFieldId!==undefined && newFieldId !== null)
            newBoundary.setId(newFieldId);
        
        builderController.toggleEditSelectedBoundary();
        //displayFieldName(true);
        callBackObject.notifyFieldUpdated();
        this.setDefaultCursor();
    };
    
    this.createHole=function(holePosition){
        this.setWaitCursor();
        builderController.getEditorController().addHole(holePosition);
        this.setDefaultCursor();
    };
    
    this.removeHole=function(holePosition){
        this.setWaitCursor();
        builderController.getEditorController().removeHole(holePosition);
        this.setDefaultCursor();
    };
    
    this.createZone = function(zonePosition){
        this.setWaitCursor();
        builderController.getEditorController().addZone(zonePosition);
        this.setDefaultCursor();
    };
    
    this.removeZone = function(zonePosition){
        this.setWaitCursor();
        builderController.getEditorController().removeZone(zonePosition);
        this.setDefaultCursor();
    };
    
    this.resetExtraLayers=function()
    {
        layers[LayerTypes.SOIL].removeAllRenderables();
        layers[LayerTypes.LANDSAT_NDVI].removeAllRenderables();
    };
    
    this.selectedFieldChanged=function()
    {
        this.resetExtraLayers();
    };
    
    this.isFieldBoundaryModified=function()
    {
        var modified=false;
        
        var boundary=builderController.getSelectedBoundary();
        if (boundary!==undefined && boundary!==null)
            modified=boundary.isModified();

        return modified;
    };
    
    this.getFieldBoundary=function(fieldId) // String fieldId
    {
        var boundaryString="";

        var boundary=builderController.findBoundary(fieldId);
        if (boundary!==undefined && boundary!==null)
            boundaryString=boundary.toLatLonString();
        
        return boundaryString;
    };
    
    this.createFieldBoundary=function(fieldId,boundaryPoints) // String fieldId,String boundaryPoints
    {
        if (boundaryPoints!==undefined && boundaryPoints!==null)
        {
            var newBoundary=FieldBoundary.fromLatLonString(boundaryPoints);
            newBoundary.setId(fieldId);
            builderController.createNewEntry(newBoundary);
            //displayFieldName(true);
        }
    };
    
    this.isSelectedFieldEditing=function()
    {
        return builderController.isSelectionEditing();
    };
    
    this.setSelectedFieldEditing=function(editing) // boolean editing
    {
        builderController.setSelectionEditing(editing);
    };
    
    this.clearBoundaries=function()
    {
//        if (isTaskPending(null /*taskClass*/)) 
//            return;
        this.selectedFieldChanged();
        builderController.removeAllBoundaries();
        //layerMap.get(LayerType.FieldName).clear();
    };
    
    this.getFieldBoundaryLayer=function()
    {
        return layers[LayerTypes.BOUNDARY];
    };
    
    this.setSelectedField=function(fieldId)
    {
        var success=false;
        var boundary=builderController.findBoundary(fieldId);
        if (boundary!==undefined && boundary!==null)
        {
            success=true;
            builderController.selectBoundary(boundary);
        }
        return success;
    };
    
    this.showSoilMap=function()
    {
        this.loadSoilMap(true /*draw*/);
    };
    
    this.getFipsPrefix=function(soilSymbol)
    {
        return soilSymbol.substring(0,5);
    };
    
    this.stripSoilSymbolFips=function(soilSymbol)
    {
        var SYMBOL_START_IDX=6;
        return soilSymbol.substring(SYMBOL_START_IDX);
    };
    
    this.soilMapRequestComplete=function(soilMapJson,draw)
    {
        var soilsObject=JSON.parse(soilMapJson);
        var soilAreas;
        if (soilsObject!==undefined && soilsObject!==null && soilsObject.soilAreas!==undefined)
            soilAreas=soilsObject.soilAreas;
        
        var selectedBoundary=builderController.getSelectedBoundary();
        var soilTypeSizes=new HashMap();
        if (soilAreas!==undefined && soilAreas!==null && soilAreas.length>0)
        {
            var soilLayer=layers[LayerTypes.SOIL];
            var attrs=Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.BLACK);

            for (var i=0; i<soilAreas.length; i++)
            {
                var area=GeoPolygon.fromLatLonString(soilAreas[i].boundary);
                var soilSymbol=soilAreas[i].soilSymbol;
                if (draw)
                {
                    var sp=this.createSurfacePolygon(area.getCesiumPoints(),attrs);
                    soilLayer.addRenderable(sp);
                }

                var areaSize=soilAreas[i].soilAcres;
                if (areaSize>0)
                {
                    if (soilTypeSizes.containsKey(soilSymbol))
                        areaSize=areaSize+soilTypeSizes.get(soilSymbol);

                    soilTypeSizes.put(soilSymbol,areaSize);
                }
                    
                if (draw)
                {
                    if (soilAreas[i].labelLat!==undefined) {
                        var labelLat=soilAreas[i].labelLat;
                        var labelLon=soilAreas[i].labelLon;
                        var displaySoilSymbol=this.stripSoilSymbolFips(soilSymbol);
                        var label=this.getLabelPrimiitive(displaySoilSymbol,LatLon.fromDegrees(labelLat,labelLon));
                        soilLayer.addRenderable(label);
                    }
                }
            }
            
            if (draw)
                layers[LayerTypes.BOUNDARY].moveToTop();
        }
        
        cachedSoilMapData="";
        if (soilTypeSizes.length()>0)
        {
            soilTypeSizes.sortByValue();
            var firstSoil=true;
            for (var i=0; i<soilTypeSizes.length(); i++)
            {
                if (firstSoil)
                {
                    firstSoil=false;
                    selectedBoundary.setFipsCode(this.getFipsPrefix(soilTypeSizes.getKey(i)));
                }
                else
                    cachedSoilMapData+=",";
                
                cachedSoilMapData+=soilTypeSizes.getKey(i)+","+Math.round(soilTypeSizes.getValue(i)*100.0)/100.0;
            }
        }

        this.setDefaultCursor();
    };
    
    this.loadSoilMap=function(draw) // boolean draw
    {   
        this.setWaitCursor();
        layers[LayerTypes.SOIL].removeAllRenderables();
        var that=this;
        var request = new XMLHttpRequest();
        var selectedBoundary=builderController.getSelectedBoundary();
        if (selectedBoundary!==undefined && selectedBoundary!==null) {
            var imageOpsUrl=this.getImageOpsUrl("/ImageOps/imageop?operation=getsoilmap&outlinePoints="+selectedBoundary.toLatLonString());
            request.onreadystatechange = function() {
                if (request.readyState === 4 && request.status===200) {
                    that.soilMapRequestComplete(request.responseText,draw);
                } 
                else if (request.readyState === 4 && request.status!=200)
                {
                    callBackObject.notifyError(request.statusText);
                    that.setDefaultCursor();
                }
            };
            request.open('GET', imageOpsUrl, true);
            request.send(null);
        }
    };
    
    this.createSurfaceImage=function(bounds,blobUrl) // GeoBoundingBox bounds,url blob
    {
        var extent = new Cesium.ExtentPrimitive({
            extent: Cesium.Extent.fromDegrees(bounds.getMinLng(),bounds.getMinLat(),bounds.getMaxLng(),bounds.getMaxLat())
        });
        extent.material = new Cesium.Material({
            fabric: {
                type: 'Image',
                uniforms: {
                    image: blobUrl
                }
            }
        });
        
        return extent;
    };
    
    this.createSurfacePolygon=function(polyPts,attrs)
    {
        var positions = widget.centralBody.getEllipsoid().cartographicArrayToCartesianArray(polyPts);
        var polygonOutlineInstance = new Cesium.GeometryInstance({
            geometry : Cesium.PolygonOutlineGeometry.fromPositions({
                positions : positions
            }),
            attributes : {
                color : attrs
            }
        });

        var polygon=new Cesium.Primitive({
            geometryInstances : [polygonOutlineInstance],
            appearance : new Cesium.PerInstanceColorAppearance({
                flat : true,
                renderState : {
                    //depthTest : {enabled : true},
                    lineWidth : Math.min(4.0, widget.scene.getContext().getMaximumAliasedLineWidth())
                }
            })
        });

        return polygon;
    };
    
    this.getLabelPrimiitive=function(label,ll) // String label,LatLon ll 
    {
        var labels = new Cesium.LabelCollection();
        
        labels.add({
            position : widget.centralBody.getEllipsoid().cartographicToCartesian(ll.getCesiumLatLon()),
            text     : label,
            fillColor : { red : 0.0, blue : 0.0, green : 0.0, alpha : 1.0 },
            horizontalOrigin : Cesium.HorizontalOrigin.CENTER
        });
        //widget.scene.getPrimitives().add(labels);
        return labels;
    };
    
    this.hideSoilMap=function()
    {
        layers[LayerTypes.SOIL].removeAllRenderables();
    };
    
    this.fipsRequestComplete=function(fipsCode)
    {
        var selectedBoundary=builderController.getSelectedBoundary();
        if (selectedBoundary!==undefined && selectedBoundary!==null) {
            selectedBoundary.setFipsCode(fipsCode);
            callBackObject.notifyFipsReceived(fipsCode);
        }
        this.setDefaultCursor();
    };
    
    this.getSelectedFieldFips=function()
    {
        var fipsCode="";
        var selectedBoundary=builderController.getSelectedBoundary();
        if (selectedBoundary!==undefined && selectedBoundary!==null)
        {
            fipsCode=selectedBoundary.getFipsCode();
            if (fipsCode===undefined || fipsCode===null || fipsCode==="")
            {
                var outerBoundaries=selectedBoundary.getOuterBoundaries();
                if (outerBoundaries!==undefined && outerBoundaries!==null && outerBoundaries.length>0)
                {
                    this.setWaitCursor();
                    var that=this;
                    var request = new XMLHttpRequest();
                    var ll=outerBoundaries[0].getPolygon().getLLBoundary()[0];
                    var imageOpsUrl=this.getImageOpsUrl("/ImageOps/imageop?operation=getfips&latitude="+ll.getLatitude()+"&longitude="+ll.getLongitude());
                    request.onreadystatechange = function() { 
                        if (request.readyState === 4 && request.status===200) {
                            that.fipsRequestComplete(request.responseText);
                        } 
                        else if (request.readyState === 4 && request.status!=200)
                        {
                            callBackObject.notifyError(request.statusText);
                            that.setDefaultCursor();
                        }
                    };
                    request.open('GET', imageOpsUrl, true);
                    request.send(null);
                }
            }
            else {
                this.fipsRequestComplete(fipsCode);
            }
        }
    };
    
    this.zoomToFields=function()
    {
        var margin=0.00045; // degree offset for around 50 meters
        var bounds=builderController.getBoundingBox();
        bounds.addMargin(margin);
        this.zoomToBounds(bounds);
    };
    
    this.zoomToBounds=function(bounds) // GeoBoundingBox bounds 
    {
        if (bounds!==undefined && bounds!==null) {
            var controller = widget.scene.getCamera().controller;
            var extent=Cesium.Extent.fromDegrees(bounds.getMinLng(),bounds.getMinLat(),bounds.getMaxLng(),bounds.getMaxLat());
            controller.viewExtent(extent);
        }
    };
    
    this.getNdviListComplete=function(ndviList)
    {
        callBackObject.notifyNdviListReceived(ndviList);
        this.setDefaultCursor();
    };

    this.getNdviList=function()
    {
        var selectedBoundary=builderController.getSelectedBoundary();
        if (selectedBoundary!==undefined && selectedBoundary!==null)
        {
            this.setWaitCursor();
            var that=this;
            var request = new XMLHttpRequest();
            var imageOpsUrl=this.getImageOpsUrl("/ImageOps/imageop?operation=getndvilist&outlinePoints="+selectedBoundary.toLatLonString());
            request.onreadystatechange = function() {
                if (request.readyState === 4 && request.status===200) {
                    that.getNdviListComplete(request.responseText);
                } 
                else if (request.readyState === 4 && request.status!=200)
                {
                    callBackObject.notifyError(request.statusText);
                    that.setDefaultCursor();
                }
            };
            request.open('GET', imageOpsUrl, true);
            request.send(null);
        }
        else
            this.getNdviListComplete("");
    };
    
    this.loadNdviComplete=function(bounds,image) // GeoBoundingBox bounds,Blob image
    {
        var surfaceImage=this.createSurfaceImage(bounds,window.URL.createObjectURL(image));
        layers[LayerTypes.LANDSAT_NDVI].addRenderable(surfaceImage);
        layers[LayerTypes.SOIL].moveToTop();
        layers[LayerTypes.BOUNDARY].moveToTop();
        this.setDefaultCursor();
    };
    
    this.showNdvi=function(ndviId)
    {
        this.setWaitCursor();
        layers[LayerTypes.LANDSAT_NDVI].removeAllRenderables();
        var selectedBoundary=builderController.getSelectedBoundary();
        if (selectedBoundary!==undefined && selectedBoundary!==null)
        {
            this.setWaitCursor();
            var that=this;
            var request = new XMLHttpRequest();
            var imageOpsUrl=this.getImageOpsUrl("/ImageOps/imageop?operation=getndvifieldclip&ndviId="+ndviId+"&outlinePoints="+selectedBoundary.toLatLonString());
            var bounds=selectedBoundary.getBoundingBox();
            request.onload = function(e) { 
                if (request.readyState === 4 && this.status===200) {
                    var blob=new Blob([this.response]);
                    that.loadNdviComplete(bounds,blob);
                } else if (request.readyState === 4 && this.status!==200){
                    callBackObject.notifyError(request.statusText);
                    this.setDefaultCursor();
                }
            };
            request.open('GET', imageOpsUrl, true);
            request.responseType='arraybuffer';
            request.send(null);
        }
    };
    
    this.hideNdvi=function()
    {
        layers[LayerTypes.LANDSAT_NDVI].removeAllRenderables();
    };
    
    this.getAerialListComplete=function(aerialList)
    {
        callBackObject.notifyAerialListReceived(aerialList);
        this.setDefaultCursor();
    };

    this.getAerialList=function()
    {
        var selectedBoundary=builderController.getSelectedBoundary();
        if (selectedBoundary!==undefined && selectedBoundary!==null)
        {
            this.setWaitCursor();
            var that=this;
            var request = new XMLHttpRequest();
            var imageOpsUrl=this.getImageOpsUrl("/ImageOps/imageop?operation=getaeriallist&outlinePoints="+selectedBoundary.toLatLonString());
            request.onreadystatechange = function() {
                if (request.readyState === 4 && request.status===200) {
                    that.getAerialListComplete(request.responseText);
                } 
                else if (request.readyState === 4 && request.status!=200)
                {
                    callBackObject.notifyError(request.statusText);
                    that.setDefaultCursor();
                }
            };
            request.open('GET', imageOpsUrl, true);
            request.send(null);
        }
        else
            this.getAerialListComplete("");
    };
    
    this.hideAerial=function()
    {
        if (layers[LayerTypes.AERIAL]!==null) {
            var cesiumLayers = widget.centralBody.getImageryLayers();
            cesiumLayers.remove(layers[LayerTypes.AERIAL],true /*destroy*/);
            layers[LayerTypes.AERIAL]=null;
        }
    };
    
    this.showAerial=function(aerialSceneId)
    {
    	if (aerialSceneId!==undefined && aerialSceneId!==null)
    	{
            this.hideAerial();
            // 'http://gis.superioredge.com:8064/cgi-bin/mapserv.exe?MAP=P:/gisproduction/aerial/hildebrandt-windmill80-8-15-2013/hildebrandt-windmill80-8-15-2013.map',
            var aerialUrl=callBackObject.getMapServerBaseUrl()+'/cgi-bin/mapserv.exe?MAP='+callBackObject.getAerialBasePath()+"/"+aerialSceneId+"/"+aerialSceneId+".map";
            var cesiumLayers = widget.centralBody.getImageryLayers();
            layers[LayerTypes.AERIAL]=cesiumLayers.addImageryProvider(
                new Cesium.WebMapServiceImageryProvider({
                        url : aerialUrl,
                        parameters : {
                            transparent : 'true',
                            format : 'image/png',
                            width: 256,
                            height: 256
                        },
                        //proxy : new Cesium.DefaultProxy('/proxy/'),
                        layers: aerialSceneId+'_layer'
                    })
            );
        }
    };
    
    this.getFieldIds=function()
    {
        var idString="";
        var boundaries=builderController.getBoundaries();
        if (boundaries!==undefined && boundaries!==null)
        {
            for (var i=0; i<boundaries.length; i++)
                idString+=","+boundaries[i].getId();
            
            if (idString!=="")
                idString=idString.substring(1);
        }
        return idString;
    };
    
    this.getYieldListComplete=function(yieldList)
    {
        callBackObject.notifyYieldIdsReceived(yieldList);
        this.setDefaultCursor();
    };

    this.getYieldList=function()
    {
        var selectedBoundary=builderController.getSelectedBoundary();
        if (selectedBoundary!==undefined && selectedBoundary!==null)
        {
            this.setWaitCursor();
            var that=this;
            var request = new XMLHttpRequest();
            // need to update this when we have grower keys
            var imageOpsUrl=this.getImageOpsUrl("/ImageOps/imageop?operation=getyieldlist&includeBounds=1&jsonFormat=1&outlinePoints="+selectedBoundary.toLatLonString()+"&enterpriseId=-1");
            request.onreadystatechange = function() {
                if (request.readyState === 4 && request.status===200) {
                    that.getYieldListComplete(request.responseText);
                } 
                else if (request.readyState === 4 && request.status!=200)
                {
                    callBackObject.notifyError(request.statusText);
                    that.setDefaultCursor();
                }
            };
            request.open('GET', imageOpsUrl, true);
            request.send(null);
        }
        else
            this.getYieldListComplete("");
    };
    
    this.loadYieldComplete=function(bounds,image) // GeoBoundingBox bounds,Blob image
    {
        var surfaceImage=this.createSurfaceImage(bounds,window.URL.createObjectURL(image));
        layers[LayerTypes.YIELD_IMAGE].addRenderable(surfaceImage);
        layers[LayerTypes.SOIL].moveToTop();
        layers[LayerTypes.BOUNDARY].moveToTop();
        this.setDefaultCursor();
    };
    
    this.showYield=function(yieldId,minLat,minLng,maxLat,maxLng)
    {
        this.setWaitCursor();
        layers[LayerTypes.YIELD_IMAGE].removeAllRenderables();
        if (yieldId!==undefined && yieldId!==null && yieldId!=="")
        {
            this.setWaitCursor();
            var that=this;
            var request = new XMLHttpRequest();
            request.responseType='arraybuffer';
            var imageOpsUrl=this.getImageOpsUrl("/ImageOps/imageop?operation=getyieldImage&yieldImageId="+yieldId);
            var bounds=new GeoBoundingBox();
            bounds.initWithMinMax(minLat,minLng,maxLat,maxLng);
            request.onload = function(e) { 
                if (this.status===200) {
                    var blob=new Blob([this.response]);
                    that.loadYieldComplete(bounds,blob);
                }
                    else{
                        callBackObject.notifyError(request.statusText);
                }
            };
            request.open('GET', imageOpsUrl, true);
            request.responseType='arraybuffer';
            request.send(null);
        }
    };
    
    this.hideYield=function()
    {
        layers[LayerTypes.YIELD_IMAGE].removeAllRenderables();
    };
    
    /******************************************************************************
    * 
    * Boundary Editor
    * 
    ******************************************************************************/

    //Pulled out of FieldContourEditor due to interferance between multiple handlers.  
    //Allow only one instance.
    
    function EditHandlers(scene) {
        var _scene = scene;
        
        // edit events
        var handler = new Cesium.ScreenSpaceEventHandler(_scene.getCanvas());
        function callPrimitiveCallback(name, position) {
            var pickedObject = _scene.pick(position);  
            if(pickedObject && pickedObject.primitive && pickedObject.primitive[name]) {
                pickedObject.primitive[name](position);
            }
        }
        handler.setInputAction(
            function (movement) {
                callPrimitiveCallback('leftClick', movement.position);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handler.setInputAction(
            function (movement) {
                callPrimitiveCallback('leftDoubleClick', movement.position);
            }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        var mouseOutObject;
        handler.setInputAction(
            function (movement) {
                var pickedObject = _scene.pick(movement.endPosition);
                if(mouseOutObject && (!pickedObject || mouseOutObject != pickedObject.primitive)) {
                    !(mouseOutObject.isDestroyed && mouseOutObject.isDestroyed()) && mouseOutObject.mouseOut(movement.endPosition);
                    mouseOutObject = null;
                }
                if(pickedObject && pickedObject.primitive) {
                    pickedObject = pickedObject.primitive;
                    if(pickedObject.mouseOut) {
                        mouseOutObject = pickedObject;
                    }
                    if(pickedObject.mouseMove) {
                        pickedObject.mouseMove(movement.endPosition);
                    }
                }
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        handler.setInputAction(
            function (movement) {
                    callPrimitiveCallback('leftUp', movement.position);
            }, Cesium.ScreenSpaceEventType.LEFT_UP);
        handler.setInputAction(
            function (movement) {
                callPrimitiveCallback('leftDown', movement.position);
            }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
            
        this.setListener = function(primitive, type, callback) {
            primitive[type] = callback;
        };

        this.destroy = function(){
            handler.destroy();
            return Cesium.destroyObject(this);
        };
         
    };


    function FieldContourEditor(args) {
    
        var ellipsoid = Cesium.Ellipsoid.WGS84;
        this._contour = args.contour;
        this._gisView = args.gisView;
        this._scene = this._gisView.getWidget().scene;
        this._handler = args.handler;
        this._tooltip = createToolTip(this._gisView.getWidget().container);
        this._message = args.message;

        this.setEditMode = function(editMode) {
            var editor = this;
            var gisView = this._gisView;
            var contour = this._contour;
            var handler = this._handler;
            // display markers
            if(editMode) {
                // create the markers and handlers for the editing
                if(this._markers == null) {
                    var markers = new BillboardGroup(editor, dragBillboard);
                    var editMarkers = new BillboardGroup(editor, dragHalfBillboard);
                    var positions = ellipsoid.cartographicArrayToCartesianArray(contour.getCesiumPoints()[0]);
                    // function for updating the edit markers around a certain point
                    function updateHalfMarkers(index, positions) {
                        // update the half markers before and after the index
                        var editIndex = index - 1 < 0 ? positions.length - 1 : index - 1;
                        editMarkers.getBillboard(editIndex).setPosition(calculateHalfMarkerPosition(editIndex));
                        editIndex = index - 1 < 0 ? 0 : index;
                        editIndex = index <= positions.length - 1 ? index: positions.length -1;
                        editMarkers.getBillboard(editIndex).setPosition(calculateHalfMarkerPosition(editIndex));
                    }
                    function onEdited() {
                        //contour.executeListeners({name: 'onEdited', positions: polygon.getPositions()});
                    }
                    var handleMarkerChanges = {
                        dragHandlers: {
                            onDrag: function(index, position) {
                                var positions = ellipsoid.cartographicArrayToCartesianArray(contour.getCesiumPoints()[0]);
                                positions[index] = position;
                                positions = ellipsoid.cartesianArrayToCartographicArray(positions);
                                var lPositions = new Array();
                                for (var i = 0; i < positions.length; i++){
                                    var lat=Cesium.Math.toDegrees(positions[i].latitude);
                                    var lng=Cesium.Math.toDegrees(positions[i].longitude);
                                    var l=LatLon.fromDegrees(lat,lng);
                                    lPositions.push(l);
                                }
                                contour.setLocations(lPositions);
                                updateHalfMarkers(index, positions);
                                gisView.getFieldBoundaryLayer().updateSelectedBoundary();

                            },
                            onDragEnd: function(index, position) {
                                onEdited();
                                gisView.getFieldBoundaryLayer().updateSelectedBoundary();
                            }
                        },
                        onDoubleClick: function(index) {
                            if(contour.getCesiumPoints()[0].length < 4) {
                                return;
                            }
                            var positions = contour.getCesiumPoints()[0];
                            positions.splice(index, 1);
                            var lPositions = new Array();
                            for (var i = 0; i < positions.length; i++){
                                var lat=Cesium.Math.toDegrees(positions[i].latitude);
                                var lng=Cesium.Math.toDegrees(positions[i].longitude);
                                var l=LatLon.fromDegrees(lat,lng);
                                lPositions.push(l);
                            }
                            contour.setLocations(lPositions);

                            markers.removeBillboard(index);
                            editMarkers.removeBillboard(index);
                            updateHalfMarkers(index, positions);
                            gisView.getFieldBoundaryLayer().updateSelectedBoundary();
                        },
                        tooltip: function() {
                            if(contour.getCesiumPoints()[0].length > 3) {
                                return "Double click to remove this point";
                            }
                        }
                    };
                    // add billboards and keep an ordered list of them for the polygon edges
                    markers.addBillboards(positions, handleMarkerChanges);
                    this._markers = markers;
                    function calculateHalfMarkerPosition(index) {      
                        var positions = ellipsoid.cartographicArrayToCartesianArray(contour.getCesiumPoints()[0]);
                        return ellipsoid.scaleToGeodeticSurface(Cesium.Cartesian3.lerp(positions[index], positions[index < positions.length - 1 ? index + 1 : 0], 0.5));
                    }
                    var halfPositions = [];
                    var index = 0;
                    for(; index < positions.length; index++) {
                        halfPositions.push(calculateHalfMarkerPosition(index));
                    }
                    var handleEditMarkerChanges = {
                        dragHandlers: {
                            onDragStart: function(index, position) {
                                // add a new position to the polygon but not a new marker yet
                                positions = ellipsoid.cartographicArrayToCartesianArray(contour.getCesiumPoints()[0]);
                                this.index = index + 1;
                                positions.splice(this.index, 0, position);
                                positions = ellipsoid.cartesianArrayToCartographicArray(positions);
                                var lPositions = new Array();
                                for (var i = 0; i < positions.length; i++){
                                    var lat=Cesium.Math.toDegrees(positions[i].latitude);
                                    var lng=Cesium.Math.toDegrees(positions[i].longitude);
                                    var l=LatLon.fromDegrees(lat,lng);
                                    lPositions.push(l);
                                }
                                contour.setLocations(lPositions);

                            },
                            onDrag: function(index, position) {
                                positions = ellipsoid.cartographicArrayToCartesianArray(contour.getCesiumPoints()[0]);
                                positions[this.index] = position;
                                positions = ellipsoid.cartesianArrayToCartographicArray(positions);
                                var lPositions = new Array();
                                for (var i = 0; i < positions.length; i++){
                                    var lat=Cesium.Math.toDegrees(positions[i].latitude);
                                    var lng=Cesium.Math.toDegrees(positions[i].longitude);
                                    var l=LatLon.fromDegrees(lat,lng);
                                    lPositions.push(l);
                                }
                                contour.setLocations(lPositions);
                                gisView.getFieldBoundaryLayer().updateSelectedBoundary();
                            },
                            onDragEnd: function(index, position) {
                                // create new sets of makers for editing
                                markers.insertBillboard(this.index, position, handleMarkerChanges);
                                editMarkers.getBillboard(this.index - 1).setPosition(calculateHalfMarkerPosition(this.index - 1));
                                editMarkers.insertBillboard(this.index, calculateHalfMarkerPosition(this.index), handleEditMarkerChanges);
                                gisView.getFieldBoundaryLayer().updateSelectedBoundary();
                            }
                        },
                        tooltip: function() {
                            return "Click to add this point";
                        }
                    };
                    editMarkers.addBillboards(halfPositions, handleEditMarkerChanges);
                    this._editMarkers = editMarkers;

                    // set on top of the polygon
                    markers.setOnTop();
                    editMarkers.setOnTop();
                }
                this._editMode = true;
            } else {
                if(this._markers != null) {
                    this._markers.remove();
                    this._editMarkers.remove();
                    this._markers = null;
                    this._editMarkers = null;
                }
                this._editMode = false;
            }
        };

        function createToolTip(frameDiv) {

            var tooltip = function(frameDiv) {

                var div = document.createElement('DIV');
                div.className = "twipsy right";

                var arrow = document.createElement('DIV');
                arrow.className = "twipsy-arrow";
                div.appendChild(arrow);

                var title = document.createElement('DIV');
                title.className = "twipsy-inner";
                div.appendChild(title);

                this._div = div;
                this._title = title;

                // add to frame div and display coordinates
                frameDiv.appendChild(div);
            };

            tooltip.prototype.setVisible = function(visible) {
                this._div.style.display = visible ? 'block' : 'none';
            };

            tooltip.prototype.showAt = function(position, message) {
                if(position && message) {
                    this.setVisible(true);
                    this._title.innerHTML = message;
                    this._div.style.left = position.x + 10 + "px";
                    this._div.style.top = (position.y - this._div.clientHeight / 2) + "px";
                }
            };

            return new tooltip(frameDiv);
        };


       var defaultBillboard = {
            iconUrl: "./gis-viewer/images/dragIcon.png",
            shiftX: 0,
            shiftY: 0
        };

        var dragBillboard = {
            iconUrl: "./gis-viewer/images/dragIcon.png",
            shiftX: 0,
            shiftY: 0
        };

        var dragHalfBillboard = {
            iconUrl: "./gis-viewer/images/dragIconLight.png",
            shiftX: 0,
            shiftY: 0
        };

        function createBillboardGroup(points, callbacks) {
            var markers = new BillboardGroup(this, defaultBillboard);
            markers.addBillboards(points, callbacks);
            return markers;
        };

        function BillboardGroup(editor, options) {
            this._editor = editor;
            this._scene = editor._scene;
            this.handler = editor._handler;

            this._options = fillOptions(options, defaultBillboard);

            // create one common billboard collection for all billboards
            var b = new Cesium.BillboardCollection();
            var a = this._scene.getContext().createTextureAtlas();
            b.setTextureAtlas(a);
            this._scene.getPrimitives().add(b);
            this._billboards = b;
            this._textureAtlas = a;
            // keep an ordered list of billboards
            this._orderedBillboards = [];

            // create the image for the billboards
            var image = new Image();
            var _self = this;
            image.onload = function() {
                a.addImage(image);
            };
            image.src = options.iconUrl;
        };

        BillboardGroup.prototype.createBillboard = function(position, callbacks) {

            var billboard = this._billboards.add({
                show : true,
                position : position,
                pixelOffset : new Cesium.Cartesian2(this._options.shiftX, this._options.shiftY),
                eyeOffset : new Cesium.Cartesian3(0.0, 0.0, 0.0),
                horizontalOrigin : Cesium.HorizontalOrigin.CENTER,
                verticalOrigin : Cesium.VerticalOrigin.CENTER,
                scale : 1,
                imageIndex : 0,
                color : new Cesium.Color(1.0, 1.0, 1.0, 1.0)
            });

            // if editable
            if(callbacks) {
                var _self = this;
                var screenSpaceCameraController = this._scene.getScreenSpaceCameraController();
                function enableRotation(enable) {
                    screenSpaceCameraController.enableRotate = enable;
                }
                function getIndex() {
                    // find index
                    for (var i = 0, I = _self._orderedBillboards.length; i < I && _self._orderedBillboards[i] != billboard; ++i);
                    return i;
                }
                if(callbacks.dragHandlers) {
                    var _self = this;
                    this.handler.setListener(billboard, 'leftDown', function(position) {
                        // TODO - start the drag handlers here
                        // create handlers for mouseOut and leftUp for the billboard and a mouseMove
                        function onDrag(position) {
                            var contour = _self._editor._contour;
                            if (contour.isHole() || contour.isZone()){
                                var parent = contour.getParent();
                                var pos = ellipsoid.cartesianToCartographic(position);
                                var lat=Cesium.Math.toDegrees(pos.latitude);
                                var lng=Cesium.Math.toDegrees(pos.longitude);
                                var ll=LatLon.fromDegrees(lat,lng);
                                if (parent.getPolygon().pointLocation(ll) != GeoPolygon.RelativeLocation.Inside){
                                    return;
                                }
                            }
                            
                            billboard.setPosition(position);
                            
                            // find index
                            for (var i = 0, I = _self._orderedBillboards.length; i < I && _self._orderedBillboards[i] != billboard; ++i);
                            callbacks.dragHandlers.onDrag && callbacks.dragHandlers.onDrag(getIndex(), position);
                            //_self.setOnTop();
                        }
                        function onDragEnd(position) {
                            handler.destroy();
                            enableRotation(true);
                            callbacks.dragHandlers.onDragEnd && callbacks.dragHandlers.onDragEnd(getIndex(), position);
                            //_self.setOnTop();
                        }

                        var handler = new Cesium.ScreenSpaceEventHandler(_self._scene.getCanvas());

                        handler.setInputAction(function(movement) {
                            var cartesian = _self._scene.getCamera().controller.pickEllipsoid(movement.endPosition, ellipsoid);
                            if (cartesian) {
                                onDrag(cartesian);
                            } else {
                                onDragEnd(cartesian);
                            }
                        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

                        handler.setInputAction(function(movement) {
                            onDragEnd(_self._scene.getCamera().controller.pickEllipsoid(movement.position, ellipsoid));
                        }, Cesium.ScreenSpaceEventType.LEFT_UP);

                        enableRotation(false);

                        callbacks.dragHandlers.onDragStart && callbacks.dragHandlers.onDragStart(getIndex(), _self._scene.getCamera().controller.pickEllipsoid(position, ellipsoid));
                    });
                }
                if(callbacks.onDoubleClick) {
                    _self.handler.setListener(billboard, 'leftDoubleClick', function(position) {
                        callbacks.onDoubleClick(getIndex());
                    });
                }
                if(callbacks.onClick) {
                    _self.handler.setListener(billboard, 'leftClick', function(position) {
                        callbacks.onClick(getIndex());
                    });
                }
                if(callbacks.tooltip) {
                    _self.handler.setListener(billboard, 'mouseMove', function(position) {
                        _self._editor._tooltip.showAt(position, callbacks.tooltip());
                    });
                    _self.handler.setListener(billboard, 'mouseOut', function(position) {
                        _self._editor._tooltip.setVisible(false);
                    });
                }
            }

            return billboard;
        };

        BillboardGroup.prototype.insertBillboard = function(index, position, callbacks) {
            this._orderedBillboards.splice(index, 0, this.createBillboard(position, callbacks));
        };

        BillboardGroup.prototype.addBillboard = function(position, callbacks) {
            this._orderedBillboards.push(this.createBillboard(position, callbacks));
        };

        BillboardGroup.prototype.addBillboards = function(positions, callbacks) {
            var index =  0;
            for(; index < positions.length; index++) {
                this.addBillboard(positions[index], callbacks);
            }
        };

        BillboardGroup.prototype.updateBillboardsPositions = function(positions) {
            var index =  0;
            for(; index < positions.length; index++) {
                this.getBillboard(index).setPosition(positions[index]);
            }
        };

        BillboardGroup.prototype.getBillboard = function(index) {
            return this._orderedBillboards[index];
        };

        BillboardGroup.prototype.removeBillboard = function(index) {
            this._billboards.remove(this.getBillboard(index));
            this._orderedBillboards.splice(index, 1);
        };

        BillboardGroup.prototype.remove = function() {
            this._billboards = this._billboards && this._billboards.removeAll() && this._billboards.destroy();
        };

        BillboardGroup.prototype.setOnTop = function() {
            this._scene.getPrimitives().raiseToTop(this._billboards);
        };



        function fillOptions(options, defaultOptions) {
            options = options || {};
            var option;
            for(option in defaultOptions) {
                if(options[option] === undefined) {
                    options[option] = defaultOptions[option];
                }
            }
            return options;
        }

        this.stopEditing = function(){
            this.setEditMode(false);
            this._primitive = this._primitive && this._primitive.destroy();
            return Cesium.destroyObject(this);
        };

        this.getHandler = function(){
            return this._handler;
        };

        this.getContour = function(){
            return this._contour;
        };

        //this.initialiseMouseHandlers();
        this.setEditMode(true);

        return this;
    }

}