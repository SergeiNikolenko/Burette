import{o as e}from"./rolldown-runtime-DAXXjFlN.js";import{t}from"./react-DWhDOMx2.js";import{t as n}from"./jsx-runtime-CFwixLRt.js";import{A as r,C as i,D as a,E as o,M as s,N as c,O as l,P as u,S as d,T as f,_ as ee,a as p,b as m,c as h,d as g,f as _,g as v,h as y,i as b,j as x,k as S,l as C,m as w,n as T,o as E,p as D,r as te,s as O,t as ne,u as k,v as re,w as A,x as ie,y as ae}from"./three.module-B9xciExR.js";import{a as j,i as oe,n as M,r as se,t as ce}from"./chemical-space-view-controls-BzMcwD8S.js";var N=e(t(),1),le={type:`change`},P={type:`start`},ue={type:`end`},de=class extends E{constructor(e,t){super(),this.object=e,this.domElement=t,this.domElement.style.touchAction=`none`,this.enabled=!0,this.target=new x,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:`ArrowLeft`,UP:`ArrowUp`,RIGHT:`ArrowRight`,BOTTOM:`ArrowDown`},this.mouseButtons={LEFT:D.ROTATE,MIDDLE:D.DOLLY,RIGHT:D.PAN},this.touches={ONE:a.ROTATE,TWO:a.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this.getPolarAngle=function(){return l.phi},this.getAzimuthalAngle=function(){return l.theta},this.getDistance=function(){return this.object.position.distanceTo(this.target)},this.listenToKeyEvents=function(e){e.addEventListener(`keydown`,J),this._domElementKeyEvents=e},this.stopListenToKeyEvents=function(){this._domElementKeyEvents.removeEventListener(`keydown`,J),this._domElementKeyEvents=null},this.saveState=function(){n.target0.copy(n.target),n.position0.copy(n.object.position),n.zoom0=n.object.zoom},this.reset=function(){n.target.copy(n.target0),n.object.position.copy(n.position0),n.object.zoom=n.zoom0,n.object.updateProjectionMatrix(),n.dispatchEvent(le),n.update(),s=i.NONE},this.update=function(){let t=new x,r=new m().setFromUnitVectors(e.up,new x(0,1,0)),a=r.clone().invert(),o=new x,p=new m,h=new x,g=2*Math.PI;return function(){let e=n.object.position;t.copy(e).sub(n.target),t.applyQuaternion(r),l.setFromVector3(t),n.autoRotate&&s===i.NONE&&O(E()),n.enableDamping?(l.theta+=u.theta*n.dampingFactor,l.phi+=u.phi*n.dampingFactor):(l.theta+=u.theta,l.phi+=u.phi);let m=n.minAzimuthAngle,_=n.maxAzimuthAngle;return isFinite(m)&&isFinite(_)&&(m<-Math.PI?m+=g:m>Math.PI&&(m-=g),_<-Math.PI?_+=g:_>Math.PI&&(_-=g),m<=_?l.theta=Math.max(m,Math.min(_,l.theta)):l.theta=l.theta>(m+_)/2?Math.max(m,l.theta):Math.min(_,l.theta)),l.phi=Math.max(n.minPolarAngle,Math.min(n.maxPolarAngle,l.phi)),l.makeSafe(),l.radius*=d,l.radius=Math.max(n.minDistance,Math.min(n.maxDistance,l.radius)),n.enableDamping===!0?n.target.addScaledVector(f,n.dampingFactor):n.target.add(f),t.setFromSpherical(l),t.applyQuaternion(a),e.copy(n.target).add(t),n.object.lookAt(n.target),n.enableDamping===!0?(u.theta*=1-n.dampingFactor,u.phi*=1-n.dampingFactor,f.multiplyScalar(1-n.dampingFactor)):(u.set(0,0,0),f.set(0,0,0)),d=1,ee||o.distanceToSquared(n.object.position)>c||8*(1-p.dot(n.object.quaternion))>c||h.distanceToSquared(n.target)>0?(n.dispatchEvent(le),o.copy(n.object.position),p.copy(n.object.quaternion),h.copy(n.target),ee=!1,!0):!1}}(),this.dispose=function(){n.domElement.removeEventListener(`contextmenu`,Z),n.domElement.removeEventListener(`pointerdown`,U),n.domElement.removeEventListener(`pointercancel`,G),n.domElement.removeEventListener(`wheel`,q),n.domElement.removeEventListener(`pointermove`,W),n.domElement.removeEventListener(`pointerup`,G),n._domElementKeyEvents!==null&&(n._domElementKeyEvents.removeEventListener(`keydown`,J),n._domElementKeyEvents=null)};let n=this,i={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},s=i.NONE,c=1e-6,l=new o,u=new o,d=1,f=new x,ee=!1,p=new r,h=new r,g=new r,_=new r,v=new r,y=new r,b=new r,S=new r,C=new r,w=[],T={};function E(){return 2*Math.PI/60/60*n.autoRotateSpeed}function te(){return .95**n.zoomSpeed}function O(e){u.theta-=e}function ne(e){u.phi-=e}let k=function(){let e=new x;return function(t,n){e.setFromMatrixColumn(n,0),e.multiplyScalar(-t),f.add(e)}}(),re=function(){let e=new x;return function(t,r){n.screenSpacePanning===!0?e.setFromMatrixColumn(r,1):(e.setFromMatrixColumn(r,0),e.crossVectors(n.object.up,e)),e.multiplyScalar(t),f.add(e)}}(),A=function(){let e=new x;return function(t,r){let i=n.domElement;if(n.object.isPerspectiveCamera){let a=n.object.position;e.copy(a).sub(n.target);let o=e.length();o*=Math.tan(n.object.fov/2*Math.PI/180),k(2*t*o/i.clientHeight,n.object.matrix),re(2*r*o/i.clientHeight,n.object.matrix)}else n.object.isOrthographicCamera?(k(t*(n.object.right-n.object.left)/n.object.zoom/i.clientWidth,n.object.matrix),re(r*(n.object.top-n.object.bottom)/n.object.zoom/i.clientHeight,n.object.matrix)):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.`),n.enablePan=!1)}}();function ie(e){n.object.isPerspectiveCamera?d/=e:n.object.isOrthographicCamera?(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom*e)),n.object.updateProjectionMatrix(),ee=!0):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),n.enableZoom=!1)}function ae(e){n.object.isPerspectiveCamera?d*=e:n.object.isOrthographicCamera?(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/e)),n.object.updateProjectionMatrix(),ee=!0):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),n.enableZoom=!1)}function j(e){p.set(e.clientX,e.clientY)}function oe(e){b.set(e.clientX,e.clientY)}function M(e){_.set(e.clientX,e.clientY)}function se(e){h.set(e.clientX,e.clientY),g.subVectors(h,p).multiplyScalar(n.rotateSpeed);let t=n.domElement;O(2*Math.PI*g.x/t.clientHeight),ne(2*Math.PI*g.y/t.clientHeight),p.copy(h),n.update()}function ce(e){S.set(e.clientX,e.clientY),C.subVectors(S,b),C.y>0?ie(te()):C.y<0&&ae(te()),b.copy(S),n.update()}function N(e){v.set(e.clientX,e.clientY),y.subVectors(v,_).multiplyScalar(n.panSpeed),A(y.x,y.y),_.copy(v),n.update()}function de(e){e.deltaY<0?ae(te()):e.deltaY>0&&ie(te()),n.update()}function fe(e){let t=!1;switch(e.code){case n.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?ne(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):A(0,n.keyPanSpeed),t=!0;break;case n.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?ne(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):A(0,-n.keyPanSpeed),t=!0;break;case n.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?O(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):A(n.keyPanSpeed,0),t=!0;break;case n.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?O(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):A(-n.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),n.update())}function F(){if(w.length===1)p.set(w[0].pageX,w[0].pageY);else{let e=.5*(w[0].pageX+w[1].pageX),t=.5*(w[0].pageY+w[1].pageY);p.set(e,t)}}function I(){if(w.length===1)_.set(w[0].pageX,w[0].pageY);else{let e=.5*(w[0].pageX+w[1].pageX),t=.5*(w[0].pageY+w[1].pageY);_.set(e,t)}}function pe(){let e=w[0].pageX-w[1].pageX,t=w[0].pageY-w[1].pageY,n=Math.sqrt(e*e+t*t);b.set(0,n)}function me(){n.enableZoom&&pe(),n.enablePan&&I()}function L(){n.enableZoom&&pe(),n.enableRotate&&F()}function R(e){if(w.length==1)h.set(e.pageX,e.pageY);else{let t=ye(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);h.set(n,r)}g.subVectors(h,p).multiplyScalar(n.rotateSpeed);let t=n.domElement;O(2*Math.PI*g.x/t.clientHeight),ne(2*Math.PI*g.y/t.clientHeight),p.copy(h)}function z(e){if(w.length===1)v.set(e.pageX,e.pageY);else{let t=ye(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);v.set(n,r)}y.subVectors(v,_).multiplyScalar(n.panSpeed),A(y.x,y.y),_.copy(v)}function B(e){let t=ye(e),r=e.pageX-t.x,i=e.pageY-t.y,a=Math.sqrt(r*r+i*i);S.set(0,a),C.set(0,(S.y/b.y)**+n.zoomSpeed),ie(C.y),b.copy(S)}function V(e){n.enableZoom&&B(e),n.enablePan&&z(e)}function H(e){n.enableZoom&&B(e),n.enableRotate&&R(e)}function U(e){n.enabled!==!1&&(w.length===0&&(n.domElement.setPointerCapture(e.pointerId),n.domElement.addEventListener(`pointermove`,W),n.domElement.addEventListener(`pointerup`,G)),ge(e),e.pointerType===`touch`?Y(e):he(e))}function W(e){n.enabled!==!1&&(e.pointerType===`touch`?X(e):K(e))}function G(e){_e(e),w.length===0&&(n.domElement.releasePointerCapture(e.pointerId),n.domElement.removeEventListener(`pointermove`,W),n.domElement.removeEventListener(`pointerup`,G)),n.dispatchEvent(ue),s=i.NONE}function he(e){let t;switch(e.button){case 0:t=n.mouseButtons.LEFT;break;case 1:t=n.mouseButtons.MIDDLE;break;case 2:t=n.mouseButtons.RIGHT;break;default:t=-1}switch(t){case D.DOLLY:if(n.enableZoom===!1)return;oe(e),s=i.DOLLY;break;case D.ROTATE:if(e.ctrlKey||e.metaKey||e.shiftKey){if(n.enablePan===!1)return;M(e),s=i.PAN}else{if(n.enableRotate===!1)return;j(e),s=i.ROTATE}break;case D.PAN:if(e.ctrlKey||e.metaKey||e.shiftKey){if(n.enableRotate===!1)return;j(e),s=i.ROTATE}else{if(n.enablePan===!1)return;M(e),s=i.PAN}break;default:s=i.NONE}s!==i.NONE&&n.dispatchEvent(P)}function K(e){switch(s){case i.ROTATE:if(n.enableRotate===!1)return;se(e);break;case i.DOLLY:if(n.enableZoom===!1)return;ce(e);break;case i.PAN:if(n.enablePan===!1)return;N(e);break}}function q(e){n.enabled===!1||n.enableZoom===!1||s!==i.NONE||(e.preventDefault(),n.dispatchEvent(P),de(e),n.dispatchEvent(ue))}function J(e){n.enabled===!1||n.enablePan===!1||fe(e)}function Y(e){switch(ve(e),w.length){case 1:switch(n.touches.ONE){case a.ROTATE:if(n.enableRotate===!1)return;F(),s=i.TOUCH_ROTATE;break;case a.PAN:if(n.enablePan===!1)return;I(),s=i.TOUCH_PAN;break;default:s=i.NONE}break;case 2:switch(n.touches.TWO){case a.DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;me(),s=i.TOUCH_DOLLY_PAN;break;case a.DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;L(),s=i.TOUCH_DOLLY_ROTATE;break;default:s=i.NONE}break;default:s=i.NONE}s!==i.NONE&&n.dispatchEvent(P)}function X(e){switch(ve(e),s){case i.TOUCH_ROTATE:if(n.enableRotate===!1)return;R(e),n.update();break;case i.TOUCH_PAN:if(n.enablePan===!1)return;z(e),n.update();break;case i.TOUCH_DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;V(e),n.update();break;case i.TOUCH_DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;H(e),n.update();break;default:s=i.NONE}}function Z(e){n.enabled!==!1&&e.preventDefault()}function ge(e){w.push(e)}function _e(e){delete T[e.pointerId];for(let t=0;t<w.length;t++)if(w[t].pointerId==e.pointerId){w.splice(t,1);return}}function ve(e){let t=T[e.pointerId];t===void 0&&(t=new r,T[e.pointerId]=t),t.set(e.pageX,e.pageY)}function ye(e){let t=e.pointerId===w[0].pointerId?w[1]:w[0];return T[t.pointerId]}n.domElement.addEventListener(`contextmenu`,Z),n.domElement.addEventListener(`pointerdown`,U),n.domElement.addEventListener(`pointercancel`,G),n.domElement.addEventListener(`wheel`,q,{passive:!1}),this.update()}};l.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new r(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},i.line={uniforms:S.merge([l.common,l.fog,l.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		void trimSegment( const in vec4 start, inout vec4 end ) {

			// trim end segment so it terminates between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
			float nearEstimate = - 0.5 * b / a;

			float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

			end.xyz = mix( start.xyz, end.xyz, alpha );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
				vUv = uv;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					trimSegment( start, end );

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					trimSegment( end, start );

				}

			}

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				// get the offset direction as perpendicular to the view vector
				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 offset;
				if ( position.y < 0.5 ) {

					offset = normalize( cross( start.xyz, worldDir ) );

				} else {

					offset = normalize( cross( end.xyz, worldDir ) );

				}

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				float forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// extend the line bounds to encompass  endcaps
					start.xyz += - worldDir * linewidth * 0.5;
					end.xyz += worldDir * linewidth * 0.5;

					// shift the position of the quad so it hugs the forward edge of the line
					offset.xy -= dir * forwardOffset;
					offset.z += 0.5;

				#endif

				// endcaps
				if ( position.y > 1.0 || position.y < 0.0 ) {

					offset.xy += dir * 2.0 * forwardOffset;

				}

				// adjust for linewidth
				offset *= linewidth * 0.5;

				// set the world position
				worldPos = ( position.y < 0.5 ) ? start : end;
				worldPos.xyz += offset;

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			float alpha = opacity;

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <encodings_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};var fe=class extends A{constructor(e){super({type:`LineMaterial`,uniforms:S.clone(i.line.uniforms),vertexShader:i.line.vertexShader,fragmentShader:i.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}},F=new T,I=new x,pe=class extends C{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new O([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new O([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new k(t,6,1);return this.setAttribute(`instanceStart`,new g(n,3,0)),this.setAttribute(`instanceEnd`,new g(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new k(t,6,1);return this.setAttribute(`instanceColorStart`,new g(n,3,0)),this.setAttribute(`instanceColorEnd`,new g(n,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new u(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new T);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),F.setFromBufferAttribute(t),this.boundingBox.union(F))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new f),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)I.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(I)),I.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(I));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},me=new x,L=new x,R=new s,z=new s,B=new s,V=new x,H=new y,U=new _,W=new x,G=new T,he=new f,K=new s,q,J;function Y(e,t,n){return K.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),K.multiplyScalar(1/K.w),K.x=J/n.width,K.y=J/n.height,K.applyMatrix4(e.projectionMatrixInverse),K.multiplyScalar(1/K.w),Math.abs(Math.max(K.x,K.y))}function X(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){U.start.fromBufferAttribute(i,r),U.end.fromBufferAttribute(a,r),U.applyMatrix4(n);let o=new x,s=new x;q.distanceSqToSegment(U.start,U.end,s,o),s.distanceTo(o)<J*.5&&t.push({point:s,pointOnLine:o,distance:q.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,uv1:null})}}function Z(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,c=o.attributes.instanceEnd,l=Math.min(o.instanceCount,s.count),u=-t.near;q.at(1,B),B.w=1,B.applyMatrix4(t.matrixWorldInverse),B.applyMatrix4(r),B.multiplyScalar(1/B.w),B.x*=i.x/2,B.y*=i.y/2,B.z=0,V.copy(B),H.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=l;t<o;t++){if(R.fromBufferAttribute(s,t),z.fromBufferAttribute(c,t),R.w=1,z.w=1,R.applyMatrix4(H),z.applyMatrix4(H),R.z>u&&z.z>u)continue;if(R.z>u){let e=R.z-z.z,t=(R.z-u)/e;R.lerp(z,t)}else if(z.z>u){let e=z.z-R.z,t=(z.z-u)/e;z.lerp(R,t)}R.applyMatrix4(r),z.applyMatrix4(r),R.multiplyScalar(1/R.w),z.multiplyScalar(1/z.w),R.x*=i.x/2,R.y*=i.y/2,z.x*=i.x/2,z.y*=i.y/2,U.start.copy(R),U.start.z=0,U.end.copy(z),U.end.z=0;let o=U.closestPointToPointParameter(V,!0);U.at(o,W);let l=w.lerp(R.z,z.z,o),d=l>=-1&&l<=1,f=V.distanceTo(W)<J*.5;if(d&&f){U.start.fromBufferAttribute(s,t),U.end.fromBufferAttribute(c,t),U.start.applyMatrix4(a),U.end.applyMatrix4(a);let r=new x,i=new x;q.distanceSqToSegment(U.start,U.end,i,r),n.push({point:i,pointOnLine:r,distance:q.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,uv1:null})}}}var ge=class extends v{constructor(e=new pe,t=new fe({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)me.fromBufferAttribute(t,e),L.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+me.distanceTo(L);let i=new k(r,2,1);return e.setAttribute(`instanceDistanceStart`,new g(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new g(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;q=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;J=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),he.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?J*.5:Y(r,Math.max(r.near,he.distanceToPoint(q.origin)),s.resolution),he.radius+=c,q.intersectsSphere(he)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),G.copy(o.boundingBox).applyMatrix4(a);let l;l=n?J*.5:Y(r,Math.max(r.near,G.distanceToPoint(q.origin)),s.resolution),G.expandByScalar(l),q.intersectsBox(G)!==!1&&(n?X(this,t):Z(this,r,t))}},_e=4096;function ve(e,t){let n=Math.max(0,Math.min(e,t));return n===e?Array.from({length:e},(e,t)=>t):n===0?[]:n===1?[0]:Array.from({length:n},(t,r)=>Math.floor(r*(e-1)/(n-1)))}function ye(e,t){let n=[];for(let r of t){let t=e[r];t&&n.push(t[0],t[1],t[2])}return n}function be(e,t,n){let r=Math.max(0,Math.min(t.length,n));if(r===0)return[];let i=[],a=t.length/r;for(let n=0;n<r;n+=1){let r=t[Math.floor(n*a)],o=r?e[r[0]]:void 0,s=r?e[r[1]]:void 0;!o||!s||i.push(o[0],o[1],o[2],s[0],s[1],s[2])}return i}async function xe(e,t,n,r,i=we){if(n<=0||t.width<=0||t.height<=0)return[];let a=Ce(t.width,t.height,n),o=Math.max(1,Math.ceil(t.width/a)),s=new Map;for(let n=0;n<e.length;n+=1){if(n>0&&n%_e===0&&(await i(),r()))return[];let c=Q(e[n],t);if(!c||c.x<0||c.x>=t.width||c.y<0||c.y>=t.height)continue;let l=Math.floor(c.x/a),u=Math.floor(c.y/a)*o+l,d=s.get(u);(!d||c.depth<d.depth)&&s.set(u,{index:n,depth:c.depth})}return r()?[]:[...s.values()].sort((e,t)=>e.index-t.index).map(({index:e})=>e).slice(0,n)}async function Se(e,t,n,r,i,a,o=we){if(r.length<3||i<=0)return[];let s=oe(r),c=[];for(let l=0;l<e.length&&c.length<i;l+=1){if(l>0&&l%_e===0&&(await o(),a()))return[];let i=Q(e[l],n);if(!i||i.x<s.minX||i.x>s.maxX||i.y<s.minY||i.y>s.maxY||!se(i,r))continue;let u=t[l];u!==void 0&&c.push(u)}return a()?[]:c}function Ce(e,t,n){let r=Math.max(2,Math.ceil(Math.sqrt(e*t/n)));for(;Math.ceil(e/r)*Math.ceil(t/r)>n;)r+=1;return r}function Q(e,t){if(!e||t.elements.length!==16)return null;let[n,r,i]=e;if(![n,r,i].every(Number.isFinite))return null;let a=t.elements,o=a[0]*n+a[4]*r+a[8]*i+a[12],s=a[1]*n+a[5]*r+a[9]*i+a[13],c=a[2]*n+a[6]*r+a[10]*i+a[14],l=a[3]*n+a[7]*r+a[11]*i+a[15];if(!Number.isFinite(l)||l<=2**-52)return null;let u=o/l,d=s/l,f=c/l;return![u,d,f].every(Number.isFinite)||f<-1||f>1?null:{x:(u*.5+.5)*t.width,y:(-d*.5+.5)*t.height,depth:f}}function we(){return new Promise(e=>{window.requestAnimationFrame(()=>e())})}var $=e(n(),1),Te=1024,Ee=4e4,De=4e4,Oe=2e4,ke=2e4,Ae=1e5,je=90,Me=.055,Ne=6,Pe=8,Fe=8;function Ie({documentKey:e,positions:t,treeEdges:n,sourceRecordIds:r,clusterIds:i,clusterColors:a,pointColors:o,cliffEdges:s,selected:l,hovered:u,preview:m,pointScale:g,treeLineScale:_,tool:v,methodLabel:y,onHover:b,onSelect:S}){let C=(0,N.useRef)(null),w=(0,N.useRef)(null),E=(0,N.useRef)(null),D=(0,N.useRef)([]),k=(0,N.useRef)(0),A=(0,N.useRef)(0),oe=(0,N.useRef)(b),se=(0,N.useRef)(S),le=(0,N.useRef)(m),[P,ue]=M(e,`camera3d`,null),F=(0,N.useRef)(P);F.current=P;let I=(0,N.useRef)(t),me=(0,N.useRef)(l),L=(0,N.useRef)(u),R=(0,N.useRef)(i),z=(0,N.useRef)(o??[]),B=(0,N.useRef)(s),[V,H]=(0,N.useState)([]),[U,W]=(0,N.useState)(!1),[G,he]=(0,N.useState)(null);oe.current=b,se.current=S,le.current=m,I.current=t,me.current=l,L.current=u,R.current=i,z.current=o??[],B.current=s;let K=(0,N.useMemo)(()=>i.some(e=>e!==null),[i]);return(0,N.useEffect)(()=>()=>{A.current+=1,k.current&&window.cancelAnimationFrame(k.current)},[]),(0,N.useEffect)(()=>{let e=C.current;if(!e)return;let i=new d,o=new ee(45,1,.01,100);o.position.fromArray(F.current?.position??[2.4,1.7,2.6]);let s=new c({alpha:!0,antialias:!0});s.setPixelRatio(Math.min(2,window.devicePixelRatio||1)),s.outputColorSpace=ie,s.domElement.className=`size-full touch-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30`,s.domElement.setAttribute(`aria-label`,`Interactive 3D ${y} chemical-space map`),s.domElement.setAttribute(`aria-keyshortcuts`,`W A S D Q E`),s.domElement.setAttribute(`role`,`application`),e.append(s.domElement);let m=new de(o,s.domElement);m.enableDamping=!1,m.enablePan=!0,m.enableZoom=!1,m.minDistance=.15,m.maxDistance=12,m.target.fromArray(F.current?.target??[0,0,0]),m.update();let v=We(e,`text-primary`,`#af52de`),b=We(e,`text-foreground`,`#f5f5f7`),S=We(e,`text-foreground`,`#f5f5f7`),w=Ge(),D=Ge(!0),k=Be(r.length),A=Ve(r.length),j=ve(r.length,Ee),M=new te;M.setAttribute(`position`,new O(ye(t,j),3));let ce=new pe,N=e=>be(e,n,De);ce.setPositions(N(t));let P=new fe({color:b.getHex(),linewidth:2.25*_,opacity:.5,transparent:!0}),V=new ge(ce,P);V.computeLineDistances(),i.add(V);let H=(e,t)=>be(e,t,Oe),U=new pe;U.setPositions(H(t,B.current));let W=new fe({color:15680580,linewidth:2.5,opacity:.85,transparent:!0}),G=new ge(U,W);G.computeLineDistances(),i.add(G);let K=e=>j.flatMap(t=>{let n=e[t]??null,r=z.current[t]??null,i=n===null?void 0:a[n],o=r?new p(r):i===void 0?S:new p(i);return[o.r,o.g,o.b]});M.setAttribute(`color`,new O(K(R.current),3));let q=new re(M,new ae({color:16777215,vertexColors:!0,map:w,alphaTest:.15,opacity:A,size:Me*g*k,sizeAttenuation:!0,transparent:!0}));i.add(q);let J=Le(b,D,Me*g*k*1.8),Y=Le(v,w,Me*g*k*2.6),X=Le(b,w,Me*g*k*1.6);for(let e of[Y,X])e.material.sizeAttenuation=!0,e.material.depthTest=!1,e.material.depthWrite=!1,e.material.toneMapped=!1;Y.material.opacity=.4,Y.renderOrder=10,X.renderOrder=11,i.add(J,Y,X);let Z=new h(2.5,10,v,b);Z.position.y=-1.08,Z.material.opacity=.3,Z.material.transparent=!0,i.add(Z);let _e=new ne(.32);_e.position.set(-1.05,-1.07,-1.05),i.add(_e);let Ce=new Map;for(let e=0;e<r.length;e+=1)Ce.set(r[e],e);let Q=null,we=!1,$=new Map,Te=0,Fe=0,Ie=0,Ke=0,qe=new x,Je=()=>{s.render(i,o)},Ye=()=>(o.updateMatrixWorld(),{elements:o.projectionMatrix.clone().multiply(o.matrixWorldInverse).elements.slice(),width:Math.max(1,e.clientWidth),height:Math.max(1,e.clientHeight)}),Xe=()=>{let t=Math.max(1,e.clientWidth),n=Math.max(1,e.clientHeight),i=new Map;for(let e of j){let a=I.current[e],s=r[e];if(!a||s===void 0||(qe.set(a[0],a[1],a[2]).project(o),qe.z<-1||qe.z>1))continue;let c={x:(qe.x*.5+.5)*t,y:(-qe.y*.5+.5)*n,depth:qe.z,sourceRecordId:s};c.x<-6||c.x>t+Ne||c.y<-6||c.y>n+Ne||Re(i,c)}$=i},Ze=()=>{let e={position:o.position.toArray(),target:m.target.toArray()};ue(t=>t&&t.position.every((t,n)=>Math.abs(t-e.position[n])<1e-9)&&t.target.every((t,n)=>Math.abs(t-e.target[n])<1e-9)?t:e)},Qe=()=>{Ze(),Je(),Xe()},$e=()=>{Te||(Te=window.requestAnimationFrame(()=>{Te=0,Qe()}),nt())},et=e=>{j=e,M.setAttribute(`position`,new O(ye(I.current,j),3)),M.setAttribute(`color`,new O(K(R.current),3)),M.computeBoundingSphere(),Qe()},tt=async e=>{if(I.current.length<=Ee){j.length!==I.current.length&&et(ve(I.current.length,Ee));return}let t=await xe(I.current,Ye(),Ee,()=>e!==Ie);e===Ie&&et(t)},nt=(e=je)=>{Ie+=1;let t=Ie;Fe&&window.clearTimeout(Fe),Fe=window.setTimeout(()=>{Fe=0,tt(t)},e)},rt=(e,t=!0)=>{let n=[...e].map(e=>Ce.get(e)).filter(e=>e!==void 0);Ue(J.geometry,ze(n,ke),I.current),t&&Je()},it=(e,t=!0)=>{let n=e===null?void 0:Ce.get(e);Ue(X.geometry,n===void 0?[]:[n],I.current),Ue(Y.geometry,n===void 0?[]:[n],I.current),t&&Je()},at=e=>{I.current=e,M.setAttribute(`position`,new O(ye(e,j),3)),M.computeBoundingSphere(),ce.setPositions(N(e)),ce.computeBoundingSphere(),V.computeLineDistances(),U.setPositions(H(e,B.current)),G.computeLineDistances(),rt(me.current,!1),it(L.current,!1),Qe(),nt(0)},ot=e=>{le.current=e},st=e=>{q.material.size=Me*e*k,J.material.size=Me*e*k*1.8,X.material.size=Me*e*k*1.6,Y.material.size=Me*e*k*2.6,Je()},ct=e=>{P.linewidth=2.25*e,Je()},lt=e=>{R.current=e,M.setAttribute(`color`,new O(K(e),3)),Je()},ut=e=>{B.current=e,U.setPositions(H(I.current,e)),G.computeLineDistances(),Je()},dt=()=>{Ke+=1},ft=async e=>{Ke+=1;let t=Ke;return Se(I.current,r,Ye(),e,Ae,()=>t!==Ke)},pt=e=>{let t=s.domElement.getBoundingClientRect();return{x:e.clientX-t.left,y:e.clientY-t.top}},mt=e=>{let t=null,n=Ne**2,r=Math.floor(e.x/Pe),i=Math.floor(e.y/Pe),a=Math.ceil(Ne/Pe);for(let o=i-a;o<=i+a;o+=1)for(let i=r-a;i<=r+a;i+=1){let r=$.get(`${i}:${o}`);if(r)for(let i of r){let r=(i.x-e.x)**2+(i.y-e.y)**2;(r<n||r===n&&(t===null||i.depth<t.depth))&&(t=i,n=r)}}return t},ht=e=>{let t=mt(pt(e))?.sourceRecordId??null;return t===L.current?t:(L.current=t,oe.current(t),t)},gt=e=>{e.preventDefault();let t=s.domElement.getBoundingClientRect(),n=new x((e.clientX-t.left)/t.width*2-1,-((e.clientY-t.top)/t.height)*2+1,.5).unproject(o).sub(o.position).normalize(),r=new x;o.getWorldDirection(r);let i=n.dot(r);if(Math.abs(i)<2**-52)return;let a=m.target.clone().sub(o.position).dot(r)/i,c=o.position.clone().addScaledVector(n,a),l=o.position.distanceTo(m.target),u=e.deltaY>0?1.1:.9,d=Math.max(m.minDistance,Math.min(m.maxDistance,l*u))/l;o.position.sub(c).multiplyScalar(d).add(c),m.target.sub(c).multiplyScalar(d).add(c),m.update(),$e()},_t=e=>{e.button===0&&(s.domElement.focus({preventScroll:!0}),L.current!==null&&(L.current=null,oe.current(null)),Q=pt(e),we=!1)},vt=e=>{if(he(pt(e)),Q){let t=pt(e);we||=Math.hypot(t.x-Q.x,t.y-Q.y)>3;return}ht(e)},yt=e=>{if(!Q||we){Q=null;return}Q=null;let t=ht(e);se.current(t===null?[]:[t])},bt=()=>{Q=null,he(null),L.current!==null&&(L.current=null,oe.current(null))},xt=e=>{let t=e.key.toLowerCase();if(![`w`,`a`,`s`,`d`,`q`,`e`].includes(t))return;e.preventDefault();let n=o.position.distanceTo(m.target),r=Math.max(.025,n*(e.shiftKey?.08:.035)),i=new x;o.getWorldDirection(i);let a=new x().crossVectors(i,o.up).normalize(),s=new x().crossVectors(a,i).normalize(),c=new x;t===`w`&&c.addScaledVector(i,r),t===`s`&&c.addScaledVector(i,-r),t===`a`&&c.addScaledVector(a,-r),t===`d`&&c.addScaledVector(a,r),t===`q`&&c.addScaledVector(s,-r),t===`e`&&c.addScaledVector(s,r),o.position.add(c),m.target.add(c),$e()},St=e=>e.preventDefault(),Ct=()=>nt(0);s.domElement.tabIndex=0,s.domElement.addEventListener(`pointerdown`,_t),s.domElement.addEventListener(`pointermove`,vt),s.domElement.addEventListener(`pointerup`,yt),s.domElement.addEventListener(`pointerleave`,bt),s.domElement.addEventListener(`wheel`,gt,{passive:!1}),s.domElement.addEventListener(`keydown`,xt),s.domElement.addEventListener(`contextmenu`,St),m.addEventListener(`change`,$e),m.addEventListener(`end`,Ct);let wt=new ResizeObserver(()=>{let t=Math.max(1,e.clientWidth),n=Math.max(1,e.clientHeight);s.setSize(t,n,!1),P.resolution.set(t,n),W.resolution.set(t,n),o.aspect=t/n,o.updateProjectionMatrix(),$e()});return wt.observe(e),E.current={restorePose:e=>{o.position.fromArray(e.position),m.target.fromArray(e.target);let t=o.position.distanceTo(m.target);m.maxDistance=Math.max(12,t*2),o.far=Math.max(100,t*4),o.updateProjectionMatrix(),m.update(),$e()},fit:e=>{let t=new T;for(let n=0;n<I.current.length;n++)e&&!me.current.has(r[n])||t.expandByPoint(new x(...I.current[n]));if(t.isEmpty())return;let n=t.getBoundingSphere(new f),i=Math.min(o.fov*Math.PI/360,Math.atan(Math.tan(o.fov*Math.PI/360)*o.aspect)),a=Math.max(m.minDistance,n.radius*1.15/Math.sin(i));m.maxDistance=Math.max(12,a*2);let s=o.position.clone().sub(m.target).normalize();m.target.copy(n.center),o.position.copy(n.center).addScaledVector(s,a),o.far=Math.max(100,a*4),o.updateProjectionMatrix(),m.update(),$e()},updatePositions:at,updateHovered:it,updateSelected:rt,updatePreview:ot,updatePointScale:st,updateTreeLineScale:ct,updateClusters:lt,updateCliffs:ut,cancelSelection:dt,selectPolygon:ft},rt(l,!1),it(u,!1),Qe(),nt(0),()=>{F.current={position:o.position.toArray(),target:m.target.toArray()},E.current=null,Ie+=1,Ke+=1,wt.disconnect(),m.removeEventListener(`change`,$e),m.removeEventListener(`end`,Ct),Te&&window.cancelAnimationFrame(Te),Fe&&window.clearTimeout(Fe),m.dispose(),s.domElement.removeEventListener(`pointerdown`,_t),s.domElement.removeEventListener(`pointermove`,vt),s.domElement.removeEventListener(`pointerup`,yt),s.domElement.removeEventListener(`pointerleave`,bt),s.domElement.removeEventListener(`wheel`,gt),s.domElement.removeEventListener(`keydown`,xt),s.domElement.removeEventListener(`contextmenu`,St),M.dispose(),q.material.dispose(),ce.dispose(),P.dispose(),U.dispose(),W.dispose(),J.geometry.dispose(),J.material.dispose(),Y.geometry.dispose(),Y.material.dispose(),X.geometry.dispose(),X.material.dispose(),Z.geometry.dispose(),He(Z.material),_e.geometry.dispose(),He(_e.material),w.dispose(),D.dispose(),s.dispose(),s.domElement.remove()}},[e,y,r,n,ue]),(0,N.useEffect)(()=>{P&&E.current?.restorePose(P)},[P]),(0,N.useEffect)(()=>E.current?.updatePositions(t),[t]),(0,N.useEffect)(()=>E.current?.updateSelected(l),[l]),(0,N.useEffect)(()=>E.current?.updateHovered(u),[u]),(0,N.useEffect)(()=>E.current?.updatePreview(m),[m]),(0,N.useEffect)(()=>E.current?.updatePointScale(g),[g]),(0,N.useEffect)(()=>E.current?.updateTreeLineScale(_),[_]),(0,N.useEffect)(()=>E.current?.updateClusters(i),[i]),(0,N.useEffect)(()=>E.current?.updateClusters(R.current),[o]),(0,N.useEffect)(()=>E.current?.updateCliffs(s),[s]),(0,N.useEffect)(()=>{v!==`lasso`&&(A.current+=1,E.current?.cancelSelection(),D.current=[],k.current&&cancelAnimationFrame(k.current),k.current=0,H([]),W(!1))},[v]),(0,N.useEffect)(()=>{let e=w.current;if(!e)return;let t=e.getBoundingClientRect(),n=Math.min(2,window.devicePixelRatio||1);e.width=Math.round(t.width*n),e.height=Math.round(t.height*n);let r=e.getContext(`2d`);if(r&&(r.setTransform(n,0,0,n,0,0),r.clearRect(0,0,t.width,t.height),!(V.length<2))){r.beginPath(),r.moveTo(V[0].x,V[0].y);for(let e of V.slice(1))r.lineTo(e.x,e.y);r.strokeStyle=`#171717`,r.lineWidth=3.5,r.stroke(),r.strokeStyle=`#ffffff`,r.lineWidth=1.75,r.setLineDash([5,4]),r.stroke()}},[V]),(0,$.jsxs)(`div`,{className:`absolute inset-0 overflow-hidden bg-muted/20`,children:[(0,$.jsx)(ce,{hasSelection:r.some(e=>l.has(e)),onFitAll:()=>E.current?.fit(!1),onFitSelection:()=>E.current?.fit(!0)}),(0,$.jsx)(`div`,{ref:C,className:`absolute inset-0`}),(0,$.jsx)(`canvas`,{ref:w,tabIndex:v===`lasso`?0:-1,className:v===`lasso`?`absolute inset-0 size-full touch-none cursor-crosshair`:`pointer-events-none absolute inset-0 size-full`,"aria-label":`3D chemical-space lasso surface`,onPointerDown:e=>{if(v!==`lasso`)return;e.currentTarget.focus({preventScroll:!0}),e.currentTarget.setPointerCapture(e.pointerId),A.current+=1,E.current?.cancelSelection(),W(!1);let t=Ke(e);D.current=[t],H([t])},onPointerMove:e=>{if(v!==`lasso`||!e.currentTarget.hasPointerCapture(e.pointerId))return;let t=Ke(e),n=D.current.at(-1);D.current.length<Te&&(!n||Math.hypot(n.x-t.x,n.y-t.y)>=2)&&(D.current.push(t),k.current||=window.requestAnimationFrame(()=>{k.current=0,H(D.current.slice())}))},onPointerUp:()=>{if(v!==`lasso`)return;let e=j(D.current);if(D.current=[],k.current&&=(window.cancelAnimationFrame(k.current),0),H([]),e.length<3||!E.current){W(!1),se.current([]);return}let t=A.current+1;A.current=t,W(!0),E.current.selectPolygon(e).then(e=>{t===A.current&&(W(!1),se.current(e))})},onPointerCancel:()=>{A.current+=1,E.current?.cancelSelection(),D.current=[],k.current&&=(window.cancelAnimationFrame(k.current),0),H([]),W(!1)}}),m&&u===m.sourceRecordId&&G?(0,$.jsxs)(`div`,{className:`pointer-events-none absolute w-52 overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg`,style:{left:`clamp(8px, ${G.x+12}px, calc(100% - 220px))`,top:`clamp(8px, ${G.y+12}px, calc(100% - 188px))`},children:[m.svgUrl?(0,$.jsx)(`img`,{className:`h-28 w-full rounded-lg bg-white object-contain`,src:m.svgUrl,alt:``}):null,(0,$.jsx)(`div`,{className:`mt-1 truncate text-xs font-medium`,children:m.name}),m.smiles?(0,$.jsx)(`div`,{className:`truncate font-mono text-[10px] text-muted-foreground`,children:m.smiles}):null]}):null,U||l.size>0?(0,$.jsx)(`div`,{className:`pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur`,children:U?`Selecting molecules…`:`${l.size.toLocaleString()} selected`}):null,K?(0,$.jsx)(`div`,{className:`pointer-events-none absolute right-2 top-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur`,children:`Colored by Butina cluster`}):null]})}function Le(e,t,n){return new re(new te,new ae({color:e,map:t,alphaTest:.15,size:n,sizeAttenuation:!0,transparent:!0}))}function Re(e,t){let n=`${Math.floor(t.x/Pe)}:${Math.floor(t.y/Pe)}`,r=e.get(n);if(!r){e.set(n,[t]);return}if(r.length<Fe){r.push(t);return}let i=0;for(let e=1;e<r.length;e+=1)r[e].depth>r[i].depth&&(i=e);t.depth<r[i].depth&&(r[i]=t)}function ze(e,t){return e.length<=t?e:ve(e.length,t).map(t=>e[t])}function Be(e){return Math.max(.45,Math.min(1,Math.sqrt(1e3/Math.max(1e3,e))))}function Ve(e){return Math.max(.48,Math.min(.82,.82*Math.sqrt(2500/Math.max(2500,e))))}function He(e){for(let t of Array.isArray(e)?e:[e])t.dispose()}function Ue(e,t,n){e.setAttribute(`position`,new O(t.flatMap(e=>n[e]??[]),3)),e.computeBoundingSphere()}function We(e,t,n){let r=document.createElement(`span`);r.className=t,e.append(r);let i=getComputedStyle(r).color;r.remove();let a=document.createElement(`canvas`);a.width=1,a.height=1;let o=a.getContext(`2d`,{willReadFrequently:!0});if(!o)return new p(n);o.fillStyle=i||n,o.fillRect(0,0,1,1);let[s,c,l]=o.getImageData(0,0,1,1).data;return new p(s/255,c/255,l/255)}function Ge(e=!1){let t=document.createElement(`canvas`);t.width=64,t.height=64;let n=t.getContext(`2d`);if(n){let t=n.createRadialGradient(32,32,4,32,32,30);t.addColorStop(0,`rgba(255,255,255,1)`),t.addColorStop(.72,`rgba(255,255,255,1)`),t.addColorStop(1,`rgba(255,255,255,0)`),n.fillStyle=t,n.fillRect(0,0,64,64),e&&(n.globalCompositeOperation=`destination-out`,n.beginPath(),n.arc(32,32,21,0,Math.PI*2),n.fillStyle=`#fff`,n.fill())}let r=new b(t);return r.colorSpace=ie,r}function Ke(e){let t=e.currentTarget.getBoundingClientRect();return{x:e.clientX-t.left,y:e.clientY-t.top}}export{Ie as ChemicalSpace3D};