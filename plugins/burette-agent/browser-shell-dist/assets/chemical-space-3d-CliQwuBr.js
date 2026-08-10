import{o as e}from"./rolldown-runtime-DAXXjFlN.js";import{t}from"./react-DWhDOMx2.js";import{t as n}from"./jsx-runtime-CFwixLRt.js";import{A as r,C as i,D as a,E as o,M as s,N as c,O as l,P as u,S as d,T as f,_ as ee,a as p,b as m,c as h,d as g,f as _,g as v,h as y,i as b,j as x,k as S,l as C,m as w,n as T,o as E,p as D,r as te,s as O,t as ne,u as k,v as re,w as A,x as ie,y as ae}from"./three.module-B9xciExR.js";import{n as j,r as M,t as oe}from"./chemical-space-lasso-CBn7oZO5.js";var N=e(t(),1),P={type:`change`},F={type:`start`},se={type:`end`},ce=class extends E{constructor(e,t){super(),this.object=e,this.domElement=t,this.domElement.style.touchAction=`none`,this.enabled=!0,this.target=new x,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:`ArrowLeft`,UP:`ArrowUp`,RIGHT:`ArrowRight`,BOTTOM:`ArrowDown`},this.mouseButtons={LEFT:D.ROTATE,MIDDLE:D.DOLLY,RIGHT:D.PAN},this.touches={ONE:a.ROTATE,TWO:a.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this.getPolarAngle=function(){return l.phi},this.getAzimuthalAngle=function(){return l.theta},this.getDistance=function(){return this.object.position.distanceTo(this.target)},this.listenToKeyEvents=function(e){e.addEventListener(`keydown`,X),this._domElementKeyEvents=e},this.stopListenToKeyEvents=function(){this._domElementKeyEvents.removeEventListener(`keydown`,X),this._domElementKeyEvents=null},this.saveState=function(){n.target0.copy(n.target),n.position0.copy(n.object.position),n.zoom0=n.object.zoom},this.reset=function(){n.target.copy(n.target0),n.object.position.copy(n.position0),n.object.zoom=n.zoom0,n.object.updateProjectionMatrix(),n.dispatchEvent(P),n.update(),s=i.NONE},this.update=function(){let t=new x,r=new m().setFromUnitVectors(e.up,new x(0,1,0)),a=r.clone().invert(),o=new x,p=new m,h=new x,g=2*Math.PI;return function(){let e=n.object.position;t.copy(e).sub(n.target),t.applyQuaternion(r),l.setFromVector3(t),n.autoRotate&&s===i.NONE&&O(E()),n.enableDamping?(l.theta+=u.theta*n.dampingFactor,l.phi+=u.phi*n.dampingFactor):(l.theta+=u.theta,l.phi+=u.phi);let m=n.minAzimuthAngle,_=n.maxAzimuthAngle;return isFinite(m)&&isFinite(_)&&(m<-Math.PI?m+=g:m>Math.PI&&(m-=g),_<-Math.PI?_+=g:_>Math.PI&&(_-=g),m<=_?l.theta=Math.max(m,Math.min(_,l.theta)):l.theta=l.theta>(m+_)/2?Math.max(m,l.theta):Math.min(_,l.theta)),l.phi=Math.max(n.minPolarAngle,Math.min(n.maxPolarAngle,l.phi)),l.makeSafe(),l.radius*=d,l.radius=Math.max(n.minDistance,Math.min(n.maxDistance,l.radius)),n.enableDamping===!0?n.target.addScaledVector(f,n.dampingFactor):n.target.add(f),t.setFromSpherical(l),t.applyQuaternion(a),e.copy(n.target).add(t),n.object.lookAt(n.target),n.enableDamping===!0?(u.theta*=1-n.dampingFactor,u.phi*=1-n.dampingFactor,f.multiplyScalar(1-n.dampingFactor)):(u.set(0,0,0),f.set(0,0,0)),d=1,ee||o.distanceToSquared(n.object.position)>c||8*(1-p.dot(n.object.quaternion))>c||h.distanceToSquared(n.target)>0?(n.dispatchEvent(P),o.copy(n.object.position),p.copy(n.object.quaternion),h.copy(n.target),ee=!1,!0):!1}}(),this.dispose=function(){n.domElement.removeEventListener(`contextmenu`,ge),n.domElement.removeEventListener(`pointerdown`,G),n.domElement.removeEventListener(`pointercancel`,q),n.domElement.removeEventListener(`wheel`,pe),n.domElement.removeEventListener(`pointermove`,K),n.domElement.removeEventListener(`pointerup`,q),n._domElementKeyEvents!==null&&(n._domElementKeyEvents.removeEventListener(`keydown`,X),n._domElementKeyEvents=null)};let n=this,i={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},s=i.NONE,c=1e-6,l=new o,u=new o,d=1,f=new x,ee=!1,p=new r,h=new r,g=new r,_=new r,v=new r,y=new r,b=new r,S=new r,C=new r,w=[],T={};function E(){return 2*Math.PI/60/60*n.autoRotateSpeed}function te(){return .95**n.zoomSpeed}function O(e){u.theta-=e}function ne(e){u.phi-=e}let k=function(){let e=new x;return function(t,n){e.setFromMatrixColumn(n,0),e.multiplyScalar(-t),f.add(e)}}(),re=function(){let e=new x;return function(t,r){n.screenSpacePanning===!0?e.setFromMatrixColumn(r,1):(e.setFromMatrixColumn(r,0),e.crossVectors(n.object.up,e)),e.multiplyScalar(t),f.add(e)}}(),A=function(){let e=new x;return function(t,r){let i=n.domElement;if(n.object.isPerspectiveCamera){let a=n.object.position;e.copy(a).sub(n.target);let o=e.length();o*=Math.tan(n.object.fov/2*Math.PI/180),k(2*t*o/i.clientHeight,n.object.matrix),re(2*r*o/i.clientHeight,n.object.matrix)}else n.object.isOrthographicCamera?(k(t*(n.object.right-n.object.left)/n.object.zoom/i.clientWidth,n.object.matrix),re(r*(n.object.top-n.object.bottom)/n.object.zoom/i.clientHeight,n.object.matrix)):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.`),n.enablePan=!1)}}();function ie(e){n.object.isPerspectiveCamera?d/=e:n.object.isOrthographicCamera?(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom*e)),n.object.updateProjectionMatrix(),ee=!0):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),n.enableZoom=!1)}function ae(e){n.object.isPerspectiveCamera?d*=e:n.object.isOrthographicCamera?(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/e)),n.object.updateProjectionMatrix(),ee=!0):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),n.enableZoom=!1)}function j(e){p.set(e.clientX,e.clientY)}function M(e){b.set(e.clientX,e.clientY)}function oe(e){_.set(e.clientX,e.clientY)}function N(e){h.set(e.clientX,e.clientY),g.subVectors(h,p).multiplyScalar(n.rotateSpeed);let t=n.domElement;O(2*Math.PI*g.x/t.clientHeight),ne(2*Math.PI*g.y/t.clientHeight),p.copy(h),n.update()}function ce(e){S.set(e.clientX,e.clientY),C.subVectors(S,b),C.y>0?ie(te()):C.y<0&&ae(te()),b.copy(S),n.update()}function le(e){v.set(e.clientX,e.clientY),y.subVectors(v,_).multiplyScalar(n.panSpeed),A(y.x,y.y),_.copy(v),n.update()}function ue(e){e.deltaY<0?ae(te()):e.deltaY>0&&ie(te()),n.update()}function I(e){let t=!1;switch(e.code){case n.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?ne(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):A(0,n.keyPanSpeed),t=!0;break;case n.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?ne(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):A(0,-n.keyPanSpeed),t=!0;break;case n.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?O(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):A(n.keyPanSpeed,0),t=!0;break;case n.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?O(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):A(-n.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),n.update())}function de(){if(w.length===1)p.set(w[0].pageX,w[0].pageY);else{let e=.5*(w[0].pageX+w[1].pageX),t=.5*(w[0].pageY+w[1].pageY);p.set(e,t)}}function L(){if(w.length===1)_.set(w[0].pageX,w[0].pageY);else{let e=.5*(w[0].pageX+w[1].pageX),t=.5*(w[0].pageY+w[1].pageY);_.set(e,t)}}function R(){let e=w[0].pageX-w[1].pageX,t=w[0].pageY-w[1].pageY,n=Math.sqrt(e*e+t*t);b.set(0,n)}function z(){n.enableZoom&&R(),n.enablePan&&L()}function B(){n.enableZoom&&R(),n.enableRotate&&de()}function V(e){if(w.length==1)h.set(e.pageX,e.pageY);else{let t=be(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);h.set(n,r)}g.subVectors(h,p).multiplyScalar(n.rotateSpeed);let t=n.domElement;O(2*Math.PI*g.x/t.clientHeight),ne(2*Math.PI*g.y/t.clientHeight),p.copy(h)}function H(e){if(w.length===1)v.set(e.pageX,e.pageY);else{let t=be(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);v.set(n,r)}y.subVectors(v,_).multiplyScalar(n.panSpeed),A(y.x,y.y),_.copy(v)}function U(e){let t=be(e),r=e.pageX-t.x,i=e.pageY-t.y,a=Math.sqrt(r*r+i*i);S.set(0,a),C.set(0,(S.y/b.y)**+n.zoomSpeed),ie(C.y),b.copy(S)}function W(e){n.enableZoom&&U(e),n.enablePan&&H(e)}function fe(e){n.enableZoom&&U(e),n.enableRotate&&V(e)}function G(e){n.enabled!==!1&&(w.length===0&&(n.domElement.setPointerCapture(e.pointerId),n.domElement.addEventListener(`pointermove`,K),n.domElement.addEventListener(`pointerup`,q)),_e(e),e.pointerType===`touch`?me(e):J(e))}function K(e){n.enabled!==!1&&(e.pointerType===`touch`?he(e):Y(e))}function q(e){ve(e),w.length===0&&(n.domElement.releasePointerCapture(e.pointerId),n.domElement.removeEventListener(`pointermove`,K),n.domElement.removeEventListener(`pointerup`,q)),n.dispatchEvent(se),s=i.NONE}function J(e){let t;switch(e.button){case 0:t=n.mouseButtons.LEFT;break;case 1:t=n.mouseButtons.MIDDLE;break;case 2:t=n.mouseButtons.RIGHT;break;default:t=-1}switch(t){case D.DOLLY:if(n.enableZoom===!1)return;M(e),s=i.DOLLY;break;case D.ROTATE:if(e.ctrlKey||e.metaKey||e.shiftKey){if(n.enablePan===!1)return;oe(e),s=i.PAN}else{if(n.enableRotate===!1)return;j(e),s=i.ROTATE}break;case D.PAN:if(e.ctrlKey||e.metaKey||e.shiftKey){if(n.enableRotate===!1)return;j(e),s=i.ROTATE}else{if(n.enablePan===!1)return;oe(e),s=i.PAN}break;default:s=i.NONE}s!==i.NONE&&n.dispatchEvent(F)}function Y(e){switch(s){case i.ROTATE:if(n.enableRotate===!1)return;N(e);break;case i.DOLLY:if(n.enableZoom===!1)return;ce(e);break;case i.PAN:if(n.enablePan===!1)return;le(e);break}}function pe(e){n.enabled===!1||n.enableZoom===!1||s!==i.NONE||(e.preventDefault(),n.dispatchEvent(F),ue(e),n.dispatchEvent(se))}function X(e){n.enabled===!1||n.enablePan===!1||I(e)}function me(e){switch(ye(e),w.length){case 1:switch(n.touches.ONE){case a.ROTATE:if(n.enableRotate===!1)return;de(),s=i.TOUCH_ROTATE;break;case a.PAN:if(n.enablePan===!1)return;L(),s=i.TOUCH_PAN;break;default:s=i.NONE}break;case 2:switch(n.touches.TWO){case a.DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;z(),s=i.TOUCH_DOLLY_PAN;break;case a.DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;B(),s=i.TOUCH_DOLLY_ROTATE;break;default:s=i.NONE}break;default:s=i.NONE}s!==i.NONE&&n.dispatchEvent(F)}function he(e){switch(ye(e),s){case i.TOUCH_ROTATE:if(n.enableRotate===!1)return;V(e),n.update();break;case i.TOUCH_PAN:if(n.enablePan===!1)return;H(e),n.update();break;case i.TOUCH_DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;W(e),n.update();break;case i.TOUCH_DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;fe(e),n.update();break;default:s=i.NONE}}function ge(e){n.enabled!==!1&&e.preventDefault()}function _e(e){w.push(e)}function ve(e){delete T[e.pointerId];for(let t=0;t<w.length;t++)if(w[t].pointerId==e.pointerId){w.splice(t,1);return}}function ye(e){let t=T[e.pointerId];t===void 0&&(t=new r,T[e.pointerId]=t),t.set(e.pageX,e.pageY)}function be(e){let t=e.pointerId===w[0].pointerId?w[1]:w[0];return T[t.pointerId]}n.domElement.addEventListener(`contextmenu`,ge),n.domElement.addEventListener(`pointerdown`,G),n.domElement.addEventListener(`pointercancel`,q),n.domElement.addEventListener(`wheel`,pe,{passive:!1}),this.update()}};l.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new r(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},i.line={uniforms:S.merge([l.common,l.fog,l.line]),vertexShader:`
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
		`};var le=class extends A{constructor(e){super({type:`LineMaterial`,uniforms:S.clone(i.line.uniforms),vertexShader:i.line.vertexShader,fragmentShader:i.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}},ue=new T,I=new x,de=class extends C{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new O([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new O([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new k(t,6,1);return this.setAttribute(`instanceStart`,new g(n,3,0)),this.setAttribute(`instanceEnd`,new g(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new k(t,6,1);return this.setAttribute(`instanceColorStart`,new g(n,3,0)),this.setAttribute(`instanceColorEnd`,new g(n,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new u(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new T);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),ue.setFromBufferAttribute(t),this.boundingBox.union(ue))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new f),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)I.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(I)),I.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(I));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},L=new x,R=new x,z=new s,B=new s,V=new s,H=new x,U=new y,W=new _,fe=new x,G=new T,K=new f,q=new s,J,Y;function pe(e,t,n){return q.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),q.multiplyScalar(1/q.w),q.x=Y/n.width,q.y=Y/n.height,q.applyMatrix4(e.projectionMatrixInverse),q.multiplyScalar(1/q.w),Math.abs(Math.max(q.x,q.y))}function X(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){W.start.fromBufferAttribute(i,r),W.end.fromBufferAttribute(a,r),W.applyMatrix4(n);let o=new x,s=new x;J.distanceSqToSegment(W.start,W.end,s,o),s.distanceTo(o)<Y*.5&&t.push({point:s,pointOnLine:o,distance:J.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,uv1:null})}}function me(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,c=o.attributes.instanceEnd,l=Math.min(o.instanceCount,s.count),u=-t.near;J.at(1,V),V.w=1,V.applyMatrix4(t.matrixWorldInverse),V.applyMatrix4(r),V.multiplyScalar(1/V.w),V.x*=i.x/2,V.y*=i.y/2,V.z=0,H.copy(V),U.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=l;t<o;t++){if(z.fromBufferAttribute(s,t),B.fromBufferAttribute(c,t),z.w=1,B.w=1,z.applyMatrix4(U),B.applyMatrix4(U),z.z>u&&B.z>u)continue;if(z.z>u){let e=z.z-B.z,t=(z.z-u)/e;z.lerp(B,t)}else if(B.z>u){let e=B.z-z.z,t=(B.z-u)/e;B.lerp(z,t)}z.applyMatrix4(r),B.applyMatrix4(r),z.multiplyScalar(1/z.w),B.multiplyScalar(1/B.w),z.x*=i.x/2,z.y*=i.y/2,B.x*=i.x/2,B.y*=i.y/2,W.start.copy(z),W.start.z=0,W.end.copy(B),W.end.z=0;let o=W.closestPointToPointParameter(H,!0);W.at(o,fe);let l=w.lerp(z.z,B.z,o),d=l>=-1&&l<=1,f=H.distanceTo(fe)<Y*.5;if(d&&f){W.start.fromBufferAttribute(s,t),W.end.fromBufferAttribute(c,t),W.start.applyMatrix4(a),W.end.applyMatrix4(a);let r=new x,i=new x;J.distanceSqToSegment(W.start,W.end,i,r),n.push({point:i,pointOnLine:r,distance:J.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,uv1:null})}}}var he=class extends v{constructor(e=new de,t=new le({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)L.fromBufferAttribute(t,e),R.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+L.distanceTo(R);let i=new k(r,2,1);return e.setAttribute(`instanceDistanceStart`,new g(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new g(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;J=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;Y=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),K.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?Y*.5:pe(r,Math.max(r.near,K.distanceToPoint(J.origin)),s.resolution),K.radius+=c,J.intersectsSphere(K)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),G.copy(o.boundingBox).applyMatrix4(a);let l;l=n?Y*.5:pe(r,Math.max(r.near,G.distanceToPoint(J.origin)),s.resolution),G.expandByScalar(l),J.intersectsBox(G)!==!1&&(n?X(this,t):me(this,r,t))}},ge=4096;function _e(e,t){let n=Math.max(0,Math.min(e,t));return n===e?Array.from({length:e},(e,t)=>t):n===0?[]:n===1?[0]:Array.from({length:n},(t,r)=>Math.floor(r*(e-1)/(n-1)))}function ve(e,t){let n=[];for(let r of t){let t=e[r];t&&n.push(t[0],t[1],t[2])}return n}function ye(e,t,n){let r=Math.max(0,Math.min(t.length,n));if(r===0)return[];let i=[],a=t.length/r;for(let n=0;n<r;n+=1){let r=t[Math.floor(n*a)],o=r?e[r[0]]:void 0,s=r?e[r[1]]:void 0;!o||!s||i.push(o[0],o[1],o[2],s[0],s[1],s[2])}return i}async function be(e,t,n,r,i=Ce){if(n<=0||t.width<=0||t.height<=0)return[];let a=Se(t.width,t.height,n),o=Math.max(1,Math.ceil(t.width/a)),s=new Map;for(let n=0;n<e.length;n+=1){if(n>0&&n%ge===0&&(await i(),r()))return[];let c=Z(e[n],t);if(!c||c.x<0||c.x>=t.width||c.y<0||c.y>=t.height)continue;let l=Math.floor(c.x/a),u=Math.floor(c.y/a)*o+l,d=s.get(u);(!d||c.depth<d.depth)&&s.set(u,{index:n,depth:c.depth})}return r()?[]:[...s.values()].sort((e,t)=>e.index-t.index).map(({index:e})=>e).slice(0,n)}async function xe(e,t,n,r,i,a,o=Ce){if(r.length<3||i<=0)return[];let s=j(r),c=[];for(let l=0;l<e.length&&c.length<i;l+=1){if(l>0&&l%ge===0&&(await o(),a()))return[];let i=Z(e[l],n);if(!i||i.x<s.minX||i.x>s.maxX||i.y<s.minY||i.y>s.maxY||!oe(i,r))continue;let u=t[l];u!==void 0&&c.push(u)}return a()?[]:c}function Se(e,t,n){let r=Math.max(2,Math.ceil(Math.sqrt(e*t/n)));for(;Math.ceil(e/r)*Math.ceil(t/r)>n;)r+=1;return r}function Z(e,t){if(!e||t.elements.length!==16)return null;let[n,r,i]=e;if(![n,r,i].every(Number.isFinite))return null;let a=t.elements,o=a[0]*n+a[4]*r+a[8]*i+a[12],s=a[1]*n+a[5]*r+a[9]*i+a[13],c=a[2]*n+a[6]*r+a[10]*i+a[14],l=a[3]*n+a[7]*r+a[11]*i+a[15];if(!Number.isFinite(l)||l<=2**-52)return null;let u=o/l,d=s/l,f=c/l;return![u,d,f].every(Number.isFinite)||f<-1||f>1?null:{x:(u*.5+.5)*t.width,y:(-d*.5+.5)*t.height,depth:f}}function Ce(){return new Promise(e=>{window.requestAnimationFrame(()=>e())})}var Q=e(n(),1),we=1024,Te=4e4,Ee=4e4,De=2e4,Oe=2e4,ke=1e5,Ae=90,je=.055,Me=6,Ne=8,$=8;function Pe({positions:e,treeEdges:t,sourceRecordIds:n,clusterIds:r,clusterColors:i,pointColors:a,cliffEdges:o,selected:s,hovered:l,preview:u,pointScale:f,treeLineScale:m,tool:g,methodLabel:_,onHover:v,onSelect:y}){let b=(0,N.useRef)(null),S=(0,N.useRef)(null),C=(0,N.useRef)(null),w=(0,N.useRef)([]),T=(0,N.useRef)(0),E=(0,N.useRef)(0),D=(0,N.useRef)(v),k=(0,N.useRef)(y),A=(0,N.useRef)(u),j=(0,N.useRef)(e),oe=(0,N.useRef)(s),P=(0,N.useRef)(l),F=(0,N.useRef)(r),se=(0,N.useRef)(a??[]),ue=(0,N.useRef)(o),[I,L]=(0,N.useState)([]),[R,z]=(0,N.useState)(!1),[B,V]=(0,N.useState)(null);D.current=v,k.current=y,A.current=u,j.current=e,oe.current=s,P.current=l,F.current=r,se.current=a??[],ue.current=o;let H=(0,N.useMemo)(()=>r.some(e=>e!==null),[r]);return(0,N.useEffect)(()=>()=>{E.current+=1,T.current&&window.cancelAnimationFrame(T.current)},[]),(0,N.useEffect)(()=>{let r=b.current;if(!r)return;let a=new d,o=new ee(45,1,.01,100);o.position.set(2.4,1.7,2.6);let u=new c({alpha:!0,antialias:!0});u.setPixelRatio(Math.min(2,window.devicePixelRatio||1)),u.outputColorSpace=ie,u.domElement.className=`size-full touch-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30`,u.domElement.setAttribute(`aria-label`,`Interactive 3D ${_} chemical-space map`),u.domElement.setAttribute(`aria-keyshortcuts`,`W A S D Q E`),u.domElement.setAttribute(`role`,`application`),r.append(u.domElement);let g=new ce(o,u.domElement);g.enableDamping=!1,g.enablePan=!0,g.enableZoom=!1,g.minDistance=.15,g.maxDistance=12,g.target.set(0,0,0);let v=He(r,`text-primary`,`#af52de`),y=He(r,`text-foreground`,`#f5f5f7`),S=He(r,`text-foreground`,`#f5f5f7`),w=Ue(),T=Re(n.length),E=ze(n.length),M=_e(n.length,Te),N=new te;N.setAttribute(`position`,new O(ve(e,M),3));let I=new de,L=e=>ye(e,t,Ee);I.setPositions(L(e));let R=new le({color:y.getHex(),linewidth:2.25*m,opacity:.5,transparent:!0}),z=new he(I,R);z.computeLineDistances(),a.add(z);let B=(e,t)=>ye(e,t,De),H=new de;H.setPositions(B(e,ue.current));let U=new le({color:15680580,linewidth:2.5,opacity:.85,transparent:!0}),W=new he(H,U);W.computeLineDistances(),a.add(W);let fe=e=>M.flatMap(t=>{let n=e[t]??null,r=se.current[t]??null,a=r?new p(r):n===null?S:new p(i[n%i.length]);return[a.r,a.g,a.b]});N.setAttribute(`color`,new O(fe(F.current),3));let G=new re(N,new ae({color:16777215,vertexColors:!0,map:w,alphaTest:.15,opacity:E,size:je*f*T,sizeAttenuation:!0,transparent:!0}));a.add(G);let K=Fe(v,w,je*f*T),q=Fe(v,w,je*f*T);a.add(K,q);let J=new h(2.5,10,v,y);J.position.y=-1.08,J.material.opacity=.3,J.material.transparent=!0,a.add(J);let Y=new ne(.32);Y.position.set(-1.05,-1.07,-1.05),a.add(Y);let pe=new Map;for(let e=0;e<n.length;e+=1)pe.set(n[e],e);let X=null,me=!1,ge=new Map,Se=0,Z=0,Ce=0,Q=0,we=new x,$=()=>{u.render(a,o)},Pe=()=>(o.updateMatrixWorld(),{elements:o.projectionMatrix.clone().multiply(o.matrixWorldInverse).elements.slice(),width:Math.max(1,r.clientWidth),height:Math.max(1,r.clientHeight)}),We=()=>{let e=Math.max(1,r.clientWidth),t=Math.max(1,r.clientHeight),i=new Map;for(let r of M){let a=j.current[r],s=n[r];if(!a||s===void 0||(we.set(a[0],a[1],a[2]).project(o),we.z<-1||we.z>1))continue;let c={x:(we.x*.5+.5)*e,y:(-we.y*.5+.5)*t,depth:we.z,sourceRecordId:s};c.x<-6||c.x>e+Me||c.y<-6||c.y>t+Me||Ie(i,c)}ge=i},Ge=()=>{$(),We()},Ke=()=>{Se||(Se=window.requestAnimationFrame(()=>{Se=0,Ge()}),Ye())},qe=e=>{M=e,N.setAttribute(`position`,new O(ve(j.current,M),3)),N.setAttribute(`color`,new O(fe(F.current),3)),N.computeBoundingSphere(),Ge()},Je=async e=>{if(j.current.length<=Te){M.length!==j.current.length&&qe(_e(j.current.length,Te));return}let t=await be(j.current,Pe(),Te,()=>e!==Ce);e===Ce&&qe(t)},Ye=(e=Ae)=>{Ce+=1;let t=Ce;Z&&window.clearTimeout(Z),Z=window.setTimeout(()=>{Z=0,Je(t)},e)},Xe=(e,t=!0)=>{let n=[...e].map(e=>pe.get(e)).filter(e=>e!==void 0);Ve(K.geometry,Le(n,Oe),j.current),t&&$()},Ze=(e,t=!0)=>{let n=e===null?void 0:pe.get(e);Ve(q.geometry,n===void 0?[]:[n],j.current),t&&$()},Qe=e=>{j.current=e,N.setAttribute(`position`,new O(ve(e,M),3)),N.computeBoundingSphere(),I.setPositions(L(e)),I.computeBoundingSphere(),z.computeLineDistances(),H.setPositions(B(e,ue.current)),W.computeLineDistances(),Xe(oe.current,!1),Ze(P.current,!1),Ge(),Ye(0)},$e=e=>{A.current=e},et=e=>{G.material.size=je*e*T,K.material.size=je*e*T,q.material.size=je*e*T,$()},tt=e=>{R.linewidth=2.25*e,$()},nt=e=>{F.current=e,N.setAttribute(`color`,new O(fe(e),3)),$()},rt=e=>{ue.current=e,H.setPositions(B(j.current,e)),W.computeLineDistances(),$()},it=()=>{Q+=1},at=async e=>{Q+=1;let t=Q;return xe(j.current,n,Pe(),e,ke,()=>t!==Q)},ot=e=>{let t=u.domElement.getBoundingClientRect();return{x:e.clientX-t.left,y:e.clientY-t.top}},st=e=>{let t=null,n=Me**2,r=Math.floor(e.x/Ne),i=Math.floor(e.y/Ne),a=Math.ceil(Me/Ne);for(let o=i-a;o<=i+a;o+=1)for(let i=r-a;i<=r+a;i+=1){let r=ge.get(`${i}:${o}`);if(r)for(let i of r){let r=(i.x-e.x)**2+(i.y-e.y)**2;(r<n||r===n&&(t===null||i.depth<t.depth))&&(t=i,n=r)}}return t},ct=e=>{let t=st(ot(e))?.sourceRecordId??null;return t===P.current?t:(P.current=t,D.current(t),t)},lt=e=>{e.preventDefault();let t=u.domElement.getBoundingClientRect(),n=new x((e.clientX-t.left)/t.width*2-1,-((e.clientY-t.top)/t.height)*2+1,.5).unproject(o).sub(o.position).normalize(),r=new x;o.getWorldDirection(r);let i=n.dot(r);if(Math.abs(i)<2**-52)return;let a=g.target.clone().sub(o.position).dot(r)/i,s=o.position.clone().addScaledVector(n,a),c=o.position.distanceTo(g.target),l=e.deltaY>0?1.1:.9,d=Math.max(g.minDistance,Math.min(g.maxDistance,c*l))/c;o.position.sub(s).multiplyScalar(d).add(s),g.target.sub(s).multiplyScalar(d).add(s),g.update(),Ke()},ut=e=>{e.button===0&&(u.domElement.focus({preventScroll:!0}),P.current!==null&&(P.current=null,D.current(null)),X=ot(e),me=!1)},dt=e=>{if(V(ot(e)),X){let t=ot(e);me||=Math.hypot(t.x-X.x,t.y-X.y)>3;return}ct(e)},ft=e=>{if(!X||me){X=null;return}X=null;let t=ct(e);k.current(t===null?[]:[t])},pt=()=>{X=null,V(null),P.current!==null&&(P.current=null,D.current(null))},mt=e=>{let t=e.key.toLowerCase();if(![`w`,`a`,`s`,`d`,`q`,`e`].includes(t))return;e.preventDefault();let n=o.position.distanceTo(g.target),r=Math.max(.025,n*(e.shiftKey?.08:.035)),i=new x;o.getWorldDirection(i);let a=new x().crossVectors(i,o.up).normalize(),s=new x().crossVectors(a,i).normalize(),c=new x;t===`w`&&c.addScaledVector(i,r),t===`s`&&c.addScaledVector(i,-r),t===`a`&&c.addScaledVector(a,-r),t===`d`&&c.addScaledVector(a,r),t===`q`&&c.addScaledVector(s,-r),t===`e`&&c.addScaledVector(s,r),o.position.add(c),g.target.add(c),Ke()},ht=e=>e.preventDefault(),gt=()=>Ye(0);u.domElement.tabIndex=0,u.domElement.addEventListener(`pointerdown`,ut),u.domElement.addEventListener(`pointermove`,dt),u.domElement.addEventListener(`pointerup`,ft),u.domElement.addEventListener(`pointerleave`,pt),u.domElement.addEventListener(`wheel`,lt,{passive:!1}),u.domElement.addEventListener(`keydown`,mt),u.domElement.addEventListener(`contextmenu`,ht),g.addEventListener(`change`,Ke),g.addEventListener(`end`,gt);let _t=new ResizeObserver(()=>{let e=Math.max(1,r.clientWidth),t=Math.max(1,r.clientHeight);u.setSize(e,t,!1),R.resolution.set(e,t),U.resolution.set(e,t),o.aspect=e/t,o.updateProjectionMatrix(),Ke()});return _t.observe(r),C.current={updatePositions:Qe,updateHovered:Ze,updateSelected:Xe,updatePreview:$e,updatePointScale:et,updateTreeLineScale:tt,updateClusters:nt,updateCliffs:rt,cancelSelection:it,selectPolygon:at},Xe(s,!1),Ze(l,!1),Ge(),Ye(0),()=>{C.current=null,Ce+=1,Q+=1,_t.disconnect(),g.removeEventListener(`change`,Ke),g.removeEventListener(`end`,gt),Se&&window.cancelAnimationFrame(Se),Z&&window.clearTimeout(Z),g.dispose(),u.domElement.removeEventListener(`pointerdown`,ut),u.domElement.removeEventListener(`pointermove`,dt),u.domElement.removeEventListener(`pointerup`,ft),u.domElement.removeEventListener(`pointerleave`,pt),u.domElement.removeEventListener(`wheel`,lt),u.domElement.removeEventListener(`keydown`,mt),u.domElement.removeEventListener(`contextmenu`,ht),N.dispose(),G.material.dispose(),I.dispose(),R.dispose(),H.dispose(),U.dispose(),K.geometry.dispose(),K.material.dispose(),q.geometry.dispose(),q.material.dispose(),J.geometry.dispose(),Be(J.material),Y.geometry.dispose(),Be(Y.material),w.dispose(),u.dispose(),u.domElement.remove()}},[_,n,t]),(0,N.useEffect)(()=>C.current?.updatePositions(e),[e]),(0,N.useEffect)(()=>C.current?.updateSelected(s),[s]),(0,N.useEffect)(()=>C.current?.updateHovered(l),[l]),(0,N.useEffect)(()=>C.current?.updatePreview(u),[u]),(0,N.useEffect)(()=>C.current?.updatePointScale(f),[f]),(0,N.useEffect)(()=>C.current?.updateTreeLineScale(m),[m]),(0,N.useEffect)(()=>C.current?.updateClusters(r),[r]),(0,N.useEffect)(()=>C.current?.updateClusters(F.current),[a]),(0,N.useEffect)(()=>C.current?.updateCliffs(o),[o]),(0,N.useEffect)(()=>{let e=S.current;if(!e)return;let t=e.getBoundingClientRect(),n=Math.min(2,window.devicePixelRatio||1);e.width=Math.round(t.width*n),e.height=Math.round(t.height*n);let r=e.getContext(`2d`);if(r&&(r.setTransform(n,0,0,n,0,0),r.clearRect(0,0,t.width,t.height),!(I.length<2))){r.beginPath(),r.moveTo(I[0].x,I[0].y);for(let e of I.slice(1))r.lineTo(e.x,e.y);r.strokeStyle=getComputedStyle(e).getPropertyValue(`--primary`).trim()||`#af52de`,r.lineWidth=1.5,r.setLineDash([5,4]),r.stroke()}},[I]),(0,Q.jsxs)(`div`,{className:`absolute inset-0 overflow-hidden bg-muted/20`,children:[(0,Q.jsx)(`div`,{ref:b,className:`absolute inset-0`}),(0,Q.jsx)(`canvas`,{ref:S,className:g===`lasso`?`absolute inset-0 size-full touch-none cursor-crosshair`:`pointer-events-none absolute inset-0 size-full`,"aria-label":`3D chemical-space lasso surface`,onPointerDown:e=>{if(g!==`lasso`)return;e.currentTarget.setPointerCapture(e.pointerId),E.current+=1,C.current?.cancelSelection(),z(!1);let t=We(e);w.current=[t],L([t])},onPointerMove:e=>{if(g!==`lasso`||!e.currentTarget.hasPointerCapture(e.pointerId))return;let t=We(e),n=w.current.at(-1);w.current.length<we&&(!n||Math.hypot(n.x-t.x,n.y-t.y)>=2)&&(w.current.push(t),T.current||=window.requestAnimationFrame(()=>{T.current=0,L(w.current.slice())}))},onPointerUp:()=>{let e=M(w.current);if(w.current=[],T.current&&=(window.cancelAnimationFrame(T.current),0),L([]),e.length<3||!C.current){z(!1),k.current([]);return}let t=E.current+1;E.current=t,z(!0),C.current.selectPolygon(e).then(e=>{t===E.current&&(z(!1),k.current(e))})},onPointerCancel:()=>{E.current+=1,C.current?.cancelSelection(),w.current=[],T.current&&=(window.cancelAnimationFrame(T.current),0),L([]),z(!1)}}),u&&l===u.sourceRecordId&&B?(0,Q.jsxs)(`div`,{className:`pointer-events-none absolute w-52 overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg`,style:{left:`clamp(8px, ${B.x+12}px, calc(100% - 220px))`,top:`clamp(8px, ${B.y+12}px, calc(100% - 188px))`},children:[u.svgUrl?(0,Q.jsx)(`img`,{className:`h-28 w-full rounded-lg bg-white object-contain`,src:u.svgUrl,alt:``}):null,(0,Q.jsx)(`div`,{className:`mt-1 truncate text-xs font-medium`,children:u.name}),u.smiles?(0,Q.jsx)(`div`,{className:`truncate font-mono text-[10px] text-muted-foreground`,children:u.smiles}):null]}):null,(0,Q.jsxs)(`div`,{className:`pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur`,children:[R?`Selecting molecules…`:`${s.size.toLocaleString()} selected`,` · drag to orbit · WASD+QE to fly · wheel to zoom`]}),H?(0,Q.jsx)(`div`,{className:`pointer-events-none absolute right-2 top-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur`,children:`Colored by Butina cluster`}):null]})}function Fe(e,t,n){return new re(new te,new ae({color:e,map:t,alphaTest:.15,size:n,sizeAttenuation:!0,transparent:!0}))}function Ie(e,t){let n=`${Math.floor(t.x/Ne)}:${Math.floor(t.y/Ne)}`,r=e.get(n);if(!r){e.set(n,[t]);return}if(r.length<$){r.push(t);return}let i=0;for(let e=1;e<r.length;e+=1)r[e].depth>r[i].depth&&(i=e);t.depth<r[i].depth&&(r[i]=t)}function Le(e,t){return e.length<=t?e:_e(e.length,t).map(t=>e[t])}function Re(e){return Math.max(.45,Math.min(1,Math.sqrt(1e3/Math.max(1e3,e))))}function ze(e){return Math.max(.48,Math.min(.82,.82*Math.sqrt(2500/Math.max(2500,e))))}function Be(e){for(let t of Array.isArray(e)?e:[e])t.dispose()}function Ve(e,t,n){e.setAttribute(`position`,new O(t.flatMap(e=>n[e]??[]),3)),e.computeBoundingSphere()}function He(e,t,n){let r=document.createElement(`span`);r.className=t,e.append(r);let i=getComputedStyle(r).color;r.remove();let a=document.createElement(`canvas`);a.width=1,a.height=1;let o=a.getContext(`2d`,{willReadFrequently:!0});if(!o)return new p(n);o.fillStyle=i||n,o.fillRect(0,0,1,1);let[s,c,l]=o.getImageData(0,0,1,1).data;return new p(s/255,c/255,l/255)}function Ue(){let e=document.createElement(`canvas`);e.width=64,e.height=64;let t=e.getContext(`2d`);if(t){let e=t.createRadialGradient(32,32,4,32,32,30);e.addColorStop(0,`rgba(255,255,255,1)`),e.addColorStop(.72,`rgba(255,255,255,1)`),e.addColorStop(1,`rgba(255,255,255,0)`),t.fillStyle=e,t.fillRect(0,0,64,64)}let n=new b(e);return n.colorSpace=ie,n}function We(e){let t=e.currentTarget.getBoundingClientRect();return{x:e.clientX-t.left,y:e.clientY-t.top}}export{Pe as ChemicalSpace3D};