/*global define*/
define(['../Core/ColorGeometryInstanceAttribute',
        '../Core/defined',
        '../Core/DeveloperError',
        '../Core/Map',
        '../Core/GeometryInstance',
        '../Core/ShowGeometryInstanceAttribute',
        '../Scene/Primitive'
    ], function(
        ColorGeometryInstanceAttribute,
        defined,
        DeveloperError,
        Map,
        GeometryInstance,
        ShowGeometryInstanceAttribute,
        Primitive) {
    "use strict";

    var Batch = function(primitives, translucent, appearanceType) {
        this.translucent = translucent;
        this.appearanceType = appearanceType;
        this.primitives = primitives;
        this.createPrimitive = false;
        this.primitive = undefined;
        this.geometry = new Map();
        this.updaters = new Map();
    };

    Batch.prototype.add = function(updater) {
        var instance = updater.createGeometryInstance();
        var id = updater.id;
        this.createPrimitive = true;
        this.geometry.set(id, instance);
        this.updaters.set(id, updater);
    };

    Batch.prototype.remove = function(updater) {
        var id = updater.id;
        this.createPrimitive = this.geometry.remove(id) || this.createPrimitive;
        this.updaters.remove(id);
    };

    Batch.prototype.update = function() {
        var primitive = this.primitive;
        var primitives = this.primitives;
        var geometry = this.geometry.getValues();
        if (this.createPrimitive) {
            if (defined(primitive)) {
                primitives.remove(primitive);
            }
            if (geometry.length > 0) {
                primitive = new Primitive({
                    asynchronous : false,
                    geometryInstances : geometry,
                    appearance : new this.appearanceType({
                        translucent : this.translucent,
                        closed : true
                    })
                });

                primitives.add(primitive);
            }
            this.primitive = primitive;
            this.createPrimitive = false;
        } else {
            var updaters = this.updaters.getValues();
            var length = geometry.length;
            for (var i = 0; i < length; i++) {
                var instance = geometry[i];
                var updater = updaters[i];

                var attributes = updater.attributes;
                if (!defined(attributes)) {
                    attributes = primitive.getGeometryInstanceAttributes(instance.id);
                    updater.attributes = attributes;
                }
                updater.updateAttributes(attributes);
            }
        }
    };

    Batch.prototype.removeAllPrimitives = function() {
        var primitive = this.primitive;
        if (defined(primitive)) {
            this.primitives.remove(primitive);
            this.primitive = undefined;
            this.geometry.removeAll();
            this.updaters.removeAll();
        }
    };

    var StaticGeometryColorBatch = function(primitives, appearanceType) {
        this._solidBatch = new Batch(primitives, false, appearanceType);
        this._translucentBatch = new Batch(primitives, true, appearanceType);
    };

    StaticGeometryColorBatch.prototype.add = function(updater) {
        if (updater.isTranslucent) {
            this._translucentBatch.add(updater);
        } else {
            this._solidBatch.add(updater);
        }
    };

    StaticGeometryColorBatch.prototype.remove = function(updater) {
        if (!this._solidBatch.remove(updater)) {
            this._translucentBatch.remove(updater);
        }
    };

    StaticGeometryColorBatch.prototype.update = function() {
        var i;
        var length;
        var updater;
        var updaters;

        //Iterate over each of the current updaters
        //to check if a color swapped from solid to translucent.
        //TODO replace this with event.
        updaters = this._solidBatch.updaters.getValues();
        length = updaters.length;
        for (i = length - 1; i >= 0; i--) {
            updater = updaters[i];
            if (updater.isTranslucent) {
                this._solidBatch.remove(updater);
                this._translucentBatch.add(updater);
            }
        }

        updaters = this._translucentBatch.updaters.getValues();
        length = updaters.length;
        for (i = length - 1; i >= 0; i--) {
            updater = updaters[i];
            if (!updater.isTranslucent) {
                this._translucentBatch.remove(updater);
                this._solidBatch.add(updater);
            }
        }

        this._solidBatch.update();
        this._translucentBatch.update();
    };

    StaticGeometryColorBatch.prototype.removeAllPrimitives = function() {
        this._solidBatch.removeAllPrimitives();
        this._translucentBatch.removeAllPrimitives();
    };

    return StaticGeometryColorBatch;
});
