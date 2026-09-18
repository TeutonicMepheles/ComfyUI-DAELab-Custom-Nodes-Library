import importlib
import sys
import types
from pathlib import Path
import unittest
import numpy as np
import torch
import cv2

ROOT = Path(__file__).resolve().parents[1]
pkg = types.ModuleType('region87_test_package'); pkg.__path__ = [str(ROOT)]
sys.modules.setdefault(pkg.__name__,pkg)
G = importlib.import_module(pkg.__name__+'.nodes.badge_app_87.region_geometry')
B = importlib.import_module(pkg.__name__+'.nodes.badge_app_87.boundary')


class GeometryTests(unittest.TestCase):
    def test_gradient_completion_stops_at_one_pixel_divider_and_preserves_islands(self):
        image=np.full((48,80,4),255,np.uint8)
        for x in range(8,36): image[8:40,x,:3]=[60+x,130+x,120+x]
        image[8:40,36,:3]=20
        image[8:40,37:60,:3]=[86,156,146]
        image[10:14,65:69,:3]=[86,156,146]
        seeds=np.full((48,80),-1,np.int16);seeds[8:40,24:28]=0;seeds[10:14,65:69]=0
        result=G.resolve(image,seeds,1)
        owner=result['owner']
        self.assertGreater(result['stats'][0]['added_pixels'],100)
        self.assertTrue((owner[8:40,36:60] == -1).all())
        self.assertTrue((owner[10:14,65:69] == 0).all())
        self.assertEqual(owner[0,0],-1)

    def test_material_independent_cache_and_layer_permutation(self):
        image=np.full((32,48,4),[90,150,140,255],np.uint8)
        seeds=np.full((32,48),-1,np.int16);seeds[8:24,8]=0;seeds[8:24,32]=1
        a=G.resolve(image,seeds,2)
        self.assertIs(a,G.resolve(image,seeds,2))
        swapped=np.where(seeds>=0,1-seeds,-1).astype(np.int16)
        b=G.resolve(image,swapped,2)
        np.testing.assert_array_equal(a['owner'],np.where(b['owner']>=0,1-b['owner'],-1))
        self.assertTrue((a['owner'][:,20] == -1).all())

    def test_manual_holes_thin_lines_and_topology(self):
        mask=np.zeros((48,48),bool);mask[5:35,5:35]=True;mask[12:28,12:28]=False
        mask[40,5:35]=True;mask[3,40]=True
        image=np.full((48,48,4),255,np.uint8)
        result=G.resolve(image,np.where(mask,0,-1).astype(np.int16),1,expand=False)
        r=result['regions'][0]
        np.testing.assert_array_equal(r['mask'],mask)
        self.assertTrue((r['coverage'][~mask] == 0).all())
        self.assertTrue((r['coverage'][40,5:35] == 1).all())
        self.assertEqual(r['coverage'][3,40],1)

    def test_boundary_reconstructs_old_colour_without_outside_change(self):
        original=np.ones((32,32,3),np.float32)
        original[8:24,8:24]=[1,0,0]
        original[8:24,8]=[1,.5,.5]
        mask=np.zeros((32,32),bool);mask[8:24,8:24]=True
        candidate=original.copy();candidate[mask]=[0,0,1]
        r=G.definition(mask)
        tensors=[torch.from_numpy(a).unsqueeze(0) for a in (original,original,candidate,mask.astype(np.float32),r['coverage'])]
        result=B.Badge87BoundaryComposite().composite(*tensors)[0][0].numpy()
        np.testing.assert_array_equal(result[~mask],original[~mask])
        np.testing.assert_array_equal(result[12:20,12:20],candidate[12:20,12:20])
        self.assertAlmostEqual(float(result[16,8,0]),float(result[16,8,1]),places=5)
        self.assertGreater(result[16,8,2],.95)
        tensors[2]=tensors[0]
        np.testing.assert_array_equal(B.Badge87BoundaryComposite().composite(*tensors)[0][0].numpy(),original)

    def test_no_seed_no_fabricated_region_and_configuration_invalidates(self):
        image=np.full((16,16,4),255,np.uint8);seeds=np.full((16,16),-1,np.int16)
        self.assertFalse(G.resolve(image,seeds,1)['regions'][0]['mask'].any())
        seeds[8,8]=0
        a=G.resolve(image,seeds,1,{'radius':2});b=G.resolve(image,seeds,1,{'radius':4})
        self.assertNotEqual(a['fingerprint'],b['fingerprint'])
        self.assertLess(a['stats'][0]['selected_pixels'],b['stats'][0]['selected_pixels'])
        with self.assertRaises(ValueError):G.resolve(image,seeds,1,{'radius':999})

    def test_coverage_has_no_tile_seam(self):
        mask=np.zeros((150,70),np.uint8)
        cv2.circle(mask,(32,32),19,1,-1)
        cv2.circle(mask,(32,96),19,1,-1)
        a=G.definition(mask)['coverage']
        # Move an identical curved edge onto the 64-row processing boundary.
        shifted=np.roll(mask,30,axis=0)
        b=G.definition(shifted)['coverage']
        np.testing.assert_array_equal(a[10:55,10:55],b[40:85,10:55])


if __name__=='__main__':unittest.main()
