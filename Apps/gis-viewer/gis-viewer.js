// TODO: Get rid of proxies and make sure the throttling works right.
// TODO: Optimize mapserver latency
// TODO: Tweak JPEG tile quality
// TODO: Figure out how to discard white tiles.
// TODO: Find a better way to trigger loading of base layers.
function WingScanGisViewer()
{
    var widget;
    var viewerPath;
    var baseTileProvider;
    var loadTimer;
    var landsatWmsUrl;
    var mapServerBaseUrl;
    var callBackObject;
    var CommandModes = {NONE:0,FINDING_FIELD:1,CREATING_FIELD:2};
    var commandMode;
    var newFieldId;
    var containerDiv;
    
    this.init = function(pCallBackObject,containerDivName,pLandsatWmsUrl,pMapServerBaseUrl,pViewerPath)
    {
        commandMode=CommandModes.NONE;
        callBackObject=pCallBackObject;
        landsatWmsUrl=pLandsatWmsUrl;
        mapServerBaseUrl=pMapServerBaseUrl;
        viewerPath=pViewerPath;
        baseTileProvider=new Cesium.SingleTileImageryProvider({ url : viewerPath+'/images/BMNG_world.topo.bathy.200405.3.2048x1024.jpg' });
        widget = new Cesium.CesiumWidget(containerDivName, { imageryProvider: baseTileProvider });
        var that=this;
        loadTimer=setInterval(function() { that.baseTileLoadCheck(); },1000);
        containerDiv=document.getElementById(containerDivName);
        containerDiv.onclick=function() {
            that.mouseClick();
        };
    };
    
    this.mouseClick=function()
    {
        if (commandMode==CommandModes.FINDING_FIELD) {
            
        }
        else {
            callBackObject.mouseClick();
        }
    };
    
    this.baseTileLoadCheck=function()
    {
        if (baseTileProvider.isReady()) {
            this.loadBaseLayers('http://data.worldwind.arc.nasa.gov/wms','http://gis.superioredge.com:8064');
            clearInterval(loadTimer);
        }
    };
    
    this.loadBaseLayers=function()
    {
         var layers = widget.centralBody.getImageryLayers();

        layers.addImageryProvider(
                    new Cesium.WebMapServiceImageryProvider({
                url: landsatWmsUrl,
                parameters: {
                    transparent: 'false',
                    format: 'image/jpeg',
                    width: 512,
                    height: 512,
                    version: '1.3'
                },
                proxy: new Cesium.DefaultProxy('/proxy/'),
                layers: 'esat'
            })
                );
                
        layers.addImageryProvider(
                new Cesium.WebMapServiceImageryProvider({
            url: mapServerBaseUrl+'/cgi-bin/mapserv.exe?MAP=m:/naip2010/mn/mn.map',
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
            layers: 'mn_2010_naip_group',
            proxy: new Cesium.DefaultProxy('/proxy/')
        })
                );
    };
    
    this.getWidget=function()
    {
        return widget;
    };
    
    this.setEyePos=function(lat,lon,altitude)
    {
        var scene=widget.scene;
        var controller = scene.getCamera().controller;
        var pos=Cesium.Cartographic.fromDegrees(lon,lat,altitude);
        controller.setPositionCartographic(pos);
    };
    
    this.setCrossHairCursor=function()
    {
        containerDiv.style.cursor='crosshair';
    };
    
    this.enterFindFieldMode=function(pNewFieldId)
    {
        newFieldId=pNewFieldId;
        if (newFieldId!==null && newFieldId==="")
            newFieldId=null;

        commandMode=CommandModes.FINDING_FIELD;
        this.setCrossHairCursor();
    };
}
