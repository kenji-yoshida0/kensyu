import Cartesian3 from "../Core/Cartesian3.js";
import combine from "../Core/combine.js";
import defined from "../Core/defined.js";
import ShaderBuilder from "../Renderer/ShaderBuilder.js";
import ShaderDestination from "../Renderer/ShaderDestination.js";
import VoxelFS from "../Shaders/Voxels/VoxelFS.js";
import VoxelVS from "../Shaders/Voxels/VoxelVS.js";
import IntersectionUtils from "../Shaders/Voxels/IntersectionUtils.js";
import IntersectDepth from "../Shaders/Voxels/IntersectDepth.js";
import IntersectClippingPlanes from "../Shaders/Voxels/IntersectClippingPlanes.js";
import IntersectBox from "../Shaders/Voxels/IntersectBox.js";
import IntersectCylinder from "../Shaders/Voxels/IntersectCylinder.js";
import IntersectEllipsoid from "../Shaders/Voxels/IntersectEllipsoid.js";
import Intersection from "../Shaders/Voxels/Intersection.js";
import convertUvToBox from "../Shaders/Voxels/convertUvToBox.js";
import convertUvToCylinder from "../Shaders/Voxels/convertUvToCylinder.js";
import convertUvToEllipsoid from "../Shaders/Voxels/convertUvToEllipsoid.js";
import Octree from "../Shaders/Voxels/Octree.js";
import Megatexture from "../Shaders/Voxels/Megatexture.js";

/**
 * Set up render resources, including basic shader code, for rendering
 * a Voxel primitive.
 * The shader code generated by this function may be modified in later stages.
 * @constructor
 * @param {VoxelPrimitive} primitive
 *
 * @private
 */
function VoxelRenderResources(primitive) {
  const shaderBuilder = new ShaderBuilder();
  /**
   * An object used to build a shader incrementally. Each pipeline stage
   * may add lines of shader code to this object.
   *
   * @type {ShaderBuilder}
   * @readonly
   *
   * @private
   */
  this.shaderBuilder = shaderBuilder;

  // Custom shader uniforms
  const customShader = primitive._customShader;
  const uniformMap = combine(primitive._uniformMap, customShader.uniformMap);
  primitive._uniformMap = uniformMap;

  const customShaderUniforms = customShader.uniforms;
  for (const uniformName in customShaderUniforms) {
    if (customShaderUniforms.hasOwnProperty(uniformName)) {
      const uniform = customShaderUniforms[uniformName];
      shaderBuilder.addUniform(
        uniform.type,
        uniformName,
        ShaderDestination.FRAGMENT
      );
    }
  }
  // The reason this uniform is added by shader builder is because some of the
  // dynamically generated shader code reads from it.
  shaderBuilder.addUniform(
    "sampler2D",
    "u_megatextureTextures[METADATA_COUNT]",
    ShaderDestination.FRAGMENT
  );

  /**
   * A dictionary mapping uniform name to functions that return the uniform
   * values.
   *
   * @type {Object<string, Function>}
   */
  this.uniformMap = uniformMap;

  const clippingPlanes = primitive._clippingPlanes;
  const clippingPlanesLength =
    defined(clippingPlanes) && clippingPlanes.enabled
      ? clippingPlanes.length
      : 0;

  this.clippingPlanes = clippingPlanes;
  this.clippingPlanesLength = clippingPlanesLength;

  // Build shader
  shaderBuilder.addVertexLines([VoxelVS]);

  shaderBuilder.addFragmentLines([
    customShader.fragmentShaderText,
    "#line 0",
    Octree,
    IntersectionUtils,
    Megatexture,
  ]);

  if (clippingPlanesLength > 0) {
    shaderBuilder.addDefine(
      "CLIPPING_PLANES",
      undefined,
      ShaderDestination.FRAGMENT
    );
    shaderBuilder.addDefine(
      "CLIPPING_PLANES_COUNT",
      clippingPlanesLength,
      ShaderDestination.FRAGMENT
    );
    if (clippingPlanes.unionClippingRegions) {
      shaderBuilder.addDefine(
        "CLIPPING_PLANES_UNION",
        undefined,
        ShaderDestination.FRAGMENT
      );
    }
    shaderBuilder.addFragmentLines([IntersectClippingPlanes]);
  }
  if (primitive._depthTest) {
    shaderBuilder.addDefine(
      "DEPTH_TEST",
      undefined,
      ShaderDestination.FRAGMENT
    );
    shaderBuilder.addFragmentLines([IntersectDepth]);
  }

  const shapeType = primitive._provider.shape;
  if (shapeType === "BOX") {
    shaderBuilder.addDefine("SHAPE_BOX", undefined, ShaderDestination.FRAGMENT);
    shaderBuilder.addFragmentLines([
      convertUvToBox,
      IntersectBox,
      Intersection,
    ]);
  } else if (shapeType === "CYLINDER") {
    shaderBuilder.addFragmentLines([
      IntersectCylinder,
      Intersection,
      convertUvToCylinder,
    ]);
  } else if (shapeType === "ELLIPSOID") {
    shaderBuilder.addFragmentLines([
      IntersectEllipsoid,
      Intersection,
      convertUvToEllipsoid,
    ]);
  }

  shaderBuilder.addFragmentLines([VoxelFS]);

  const shape = primitive._shape;
  const shapeDefines = shape.shaderDefines;
  for (const key in shapeDefines) {
    if (shapeDefines.hasOwnProperty(key)) {
      let value = shapeDefines[key];
      // if value is undefined, don't define it
      // if value is true, define it to nothing
      if (defined(value)) {
        value = value === true ? undefined : value;
        shaderBuilder.addDefine(key, value, ShaderDestination.FRAGMENT);
      }
    }
  }

  // Count how many intersections the shader will do.
  let intersectionCount = shape.shaderMaximumIntersectionsLength;
  if (clippingPlanesLength > 0) {
    shaderBuilder.addDefine(
      "CLIPPING_PLANES_INTERSECTION_INDEX",
      intersectionCount,
      ShaderDestination.FRAGMENT
    );
    if (clippingPlanesLength === 1) {
      intersectionCount += 1;
    } else if (clippingPlanes.unionClippingRegions) {
      intersectionCount += 2;
    } else {
      intersectionCount += 1;
    }
  }
  if (primitive._depthTest) {
    shaderBuilder.addDefine(
      "DEPTH_INTERSECTION_INDEX",
      intersectionCount,
      ShaderDestination.FRAGMENT
    );
    intersectionCount += 1;
  }
  shaderBuilder.addDefine(
    "INTERSECTION_COUNT",
    intersectionCount,
    ShaderDestination.FRAGMENT
  );

  // Additional fragment shader defines
  if (
    !Cartesian3.equals(primitive.paddingBefore, Cartesian3.ZERO) ||
    !Cartesian3.equals(primitive.paddingAfter, Cartesian3.ZERO)
  ) {
    shaderBuilder.addDefine("PADDING", undefined, ShaderDestination.FRAGMENT);
  }
  // Allow reading from log depth texture, but don't write log depth anywhere.
  // Note: This needs to be set even if depthTest is off because it affects the
  // derived command system.
  if (primitive._useLogDepth) {
    shaderBuilder.addDefine(
      "LOG_DEPTH_READ_ONLY",
      undefined,
      ShaderDestination.FRAGMENT
    );
  }
  if (primitive._jitter) {
    shaderBuilder.addDefine("JITTER", undefined, ShaderDestination.FRAGMENT);
  }
  if (primitive._nearestSampling) {
    shaderBuilder.addDefine(
      "NEAREST_SAMPLING",
      undefined,
      ShaderDestination.FRAGMENT
    );
  }
  const traversal = primitive._traversal;
  shaderBuilder.addDefine(
    "SAMPLE_COUNT",
    `${traversal._sampleCount}`,
    ShaderDestination.FRAGMENT
  );
}

export default VoxelRenderResources;
